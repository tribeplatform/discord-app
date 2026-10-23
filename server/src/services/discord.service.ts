import { Client, Intents, MessageActionRow, MessageButton, MessageEmbed } from 'discord.js';
import { Types } from '@tribeplatform/gql-client';

import { createLogger } from '@/utils/logger';
import * as blockUtils from '@utils/blockParser';
import * as utils from '@utils/util';

import { BOT_TOKEN } from '@/config';
import { DiscordFooter } from '@/type/discord-footer.type';
import { getEntityName } from '@utils/blockParser';

const TITLE_LENGTH_LIMIT = 100;
const CONTENT_LENGTH_LIMIT = 250;
const IMAGE_SERVICE_URL = 'https://tribe-s3-production.imgix.net';
const MAXIMUM_TIME_FOR_DEFAULT_SPACES = 50 * 1000;

// Bot login retries back off from 30s to 15min. A rejected token never crashes the process, so the
// HTTP server (health check, webhooks, OAuth) stays up while the token is fixed.
export const LOGIN_RETRY_BASE_MS = 30 * 1000;
export const LOGIN_RETRY_MAX_MS = 15 * 60 * 1000;
// A channel the bot cannot reach (deleted, or the bot was removed from the server) is not looked up again for an hour.
export const UNREACHABLE_CHANNEL_TTL_MS = 60 * 60 * 1000;

// One logger for the module: every node-logger instance registers its own process 'uncaughtException' handler.
const logger = createLogger('DiscordService');

export const getLoginRetryDelay = (attempt: number) => Math.min(LOGIN_RETRY_BASE_MS * 2 ** attempt, LOGIN_RETRY_MAX_MS);

export class DiscordService {
  private client;
  private isAppReady: boolean;
  private loginTimer: NodeJS.Timeout;
  private readonly unreachableChannels = new Map<string, number>();

  constructor(client?: Client) {
    this.isAppReady = false;

    this.client =
      client ||
      new Client({
        intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
      });

    this.client.on('ready', () => {
      this.isAppReady = true;
      logger.log(`Discord bot logged in as ${this.client.user?.tag}`);
    });
    // Without an 'error' listener an emitted error is thrown and takes the process down.
    this.client.on('error', err => logger.error(err));
    this.client.on('shardError', err => logger.warn(`Discord gateway connection error: ${err?.message}`));
    this.client.on('invalidated', () => {
      // The session can't be resumed and discord.js has destroyed the client: log in again.
      this.isAppReady = false;
      logger.warn('Discord session invalidated, logging in again');
      this.scheduleLogin(0);
    });

    this.login();
  }

  public get isReady() {
    return this.isAppReady;
  }

  public async login(attempt = 0): Promise<void> {
    try {
      await this.client.login(BOT_TOKEN);
    } catch (err) {
      this.isAppReady = false;
      const delay = getLoginRetryDelay(attempt);
      // Never log the token itself; discord.js errors only carry a code such as TOKEN_INVALID.
      logger.error(`Discord bot login failed (${err?.code || err?.message}), retrying in ${Math.round(delay / 1000)}s`);
      this.scheduleLogin(delay, attempt + 1);
    }
  }

  private scheduleLogin(delay: number, attempt = 0) {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = setTimeout(() => this.login(attempt), delay);
    // Don't keep the process (or a test run) alive just for a retry.
    this.loginTimer.unref?.();
  }

  /**
   * Resolves a text channel from the cache, or from the Discord API when it isn't cached.
   * Returns null (and logs once) when the bot can't reach the channel.
   */
  private async getTextChannel(channelId: string) {
    if (!channelId) return null;
    if (!this.isAppReady) {
      logger.warn(`Discord bot is not logged in, skipping channelId=${channelId}`);
      return null;
    }
    const skippedAt = this.unreachableChannels.get(channelId);
    if (skippedAt && Date.now() - skippedAt < UNREACHABLE_CHANNEL_TTL_MS) return null;
    try {
      const channel = this.client.channels.cache.get(channelId) || (await this.client.channels.fetch(channelId));
      if (channel && typeof channel.send === 'function') {
        this.unreachableChannels.delete(channelId);
        return channel;
      }
      logger.warn(`Discord channel is not a text channel channelId=${channelId}`);
    } catch (err) {
      // 10003 Unknown Channel, 50001 Missing Access: the channel was deleted or the bot was removed from the server.
      logger.warn(`Discord channel is not reachable channelId=${channelId} code=${err?.code} message=${err?.message}`);
    }
    this.unreachableChannels.set(channelId, Date.now());
    return null;
  }

  /**
   * Throws when the bot can't post in the channel, so the OAuth install fails with Discord's error instead of
   * saving a connection that will never receive messages.
   */
  public async sendWelcomeMessage(channelId: string) {
    const channel = this.client.channels.cache.get(channelId) || (await this.client.channels.fetch(channelId));
    if (!channel || typeof channel.send !== 'function') throw new Error('The selected Discord channel is not a text channel');
    this.unreachableChannels.delete(channelId);
    await channel.send('Hi there, *Community Bot* is here! I would inform you on community updates in this channel.');
  }

  public async getChannelInfo(channelId: string) {
    return await this.client.channels.fetch(channelId);
  }

  public async sendDiscordMessage(channelId: string, payload: any) {
    try {
      logger.log('GENERATING EMBED');
      const components = new MessageActionRow()
      const dataToSend = new MessageEmbed()
        .setColor('#0099ff')
        .setAuthor({
          name: payload.network?.name,
          iconURL: (payload.network?.favicon as Types.Image)?.urls?.small,
          url: `https://${payload.network?.domain}`,
        })
        .setTimestamp();

      if (payload.member?.profilePicture?.url) {
        dataToSend.setThumbnail(payload.member.profilePicture.url);
      }

      if (payload?.space?.name) {
        let footer: DiscordFooter = {
          text: `Space: ${payload.space.name}`,
        };
        if (payload.space?.banner?.url) {
          footer.iconURL = payload.space.banner.url;
        }
        dataToSend.setFooter(footer);
      }


      let { sentences, title } = this.sentenceBuilder(payload,components);

      if (!sentences.length) return;

      logger.log(`GENERATED SENTENCE ${JSON.stringify(sentences)}`);

      const text = sentences[0];
      sentences[0] = ':bell: ' + text;

      if (payload.post) {
        const parent = payload.post?.repliedTos?.length ? payload.post?.repliedTos.find(post => !post.repliedToId) : payload.post;
        if (parent?.title) {
          sentences[0] =
            sentences[0] +
            blockUtils.createHyperlink({
              text: `\n**${blockUtils.truncate(parent.title, TITLE_LENGTH_LIMIT)}**`,
              url: payload.post.url,
            });
        }

        if (payload.post?.shortContent) {
          let parsed = blockUtils.parseHtml(utils.transformMentions(payload.post.shortContent, `https://${payload.network.domain}/member/`));

          logger.log(`REFORMATTING ON ${JSON.stringify(parsed)}`);

          // to remove unwanted lines
          const filteredSentences = [];
          const dataLines = parsed.split('\n');
          for (let lines = 0; lines < dataLines.length; lines++) {
            if (dataLines[lines].startsWith('![]')) continue; // skipping images

            if (dataLines[lines].startsWith('>'))
              // remove quote
              dataLines[lines] = dataLines[lines].replace('> ', '');

            filteredSentences.push(dataLines[lines]);
          }

          parsed = filteredSentences.join('\n > ');

          parsed = blockUtils.truncate(parsed, CONTENT_LENGTH_LIMIT);

          if (parsed && parsed.length) sentences.push(blockUtils.createQuote(parsed));

          sentences = this.addImages(payload, sentences);

          sentences = this.addEmbeds(payload, sentences);

          sentences = this.addAttachments(payload, sentences);
        }
      }

      dataToSend.setDescription(sentences.join('\n\n'));

      logger.log('FETCHING CHANNEL NAME');

    
      const toSendObject = {
        content:title,
        embeds:[dataToSend]
      }

      if(components.components.length){
        Object.assign(toSendObject,{components:[components]})
      }

      const channel = await this.getTextChannel(channelId);
      if (!channel) return;
      await channel.send(toSendObject);

    } catch (e) {
      logger.error(e);
    }
  }

  private sentenceBuilder(payload: any,components: MessageActionRow): { sentences: string[], components: MessageActionRow, title: string } {

    const sentences: string[] = [];
    let title = '';
    logger.log(`EVENT ON ${payload.event}`);

    switch (payload.event) {
      case 'post.published':
        title = `${blockUtils.getEntityName(payload.member)} added a new ${payload.post.repliedToId ? 'reply' : 'post'} to ${getEntityName(payload.space)}`;
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} added a ${payload.post.repliedToId ? 'reply to:' : 'post to:'}`);
        break;
      case 'member.verified':
        title = `${getEntityName(payload.member)} joined the community`;
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} joined the community`);
        break;
      case 'moderation.created':
        components.addComponents(
          new MessageButton()
              .setLabel('Go to moderation')
              .setURL(`https://${payload.network.domain}/settings/moderation`)
              .setStyle('LINK'),
          );
        if (payload.post) {
          title = `A post flagged for moderation`;
          sentences.push(`A post flagged for moderation`);
        } else {
          title = `${getEntityName(payload.member)} was flagged for moderation`;
          sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} was flagged for moderation`);
        }
        break;
      case 'moderation.rejected':
        if (payload.post) {
          title = `${getEntityName(payload.actor)} approved this post`;
          sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} approved this post`);
        }
        break;
      case 'moderation.accepted':
        if (payload.post) {
          title = `${getEntityName(payload.actor)} rejected this post`;
          sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} rejected this post`);
        }
        break;
      case 'space_membership.created':
        // No actor means nobody added the member (they joined, or were added automatically).
        if (!payload?.actor || payload?.member?.id === payload?.actor?.id) {
          if (!this.isRecentlyJoined(payload)) {
            title = `${getEntityName(payload.member)} joined ${getEntityName(payload.space)}`;
            sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} joined ${blockUtils.createEntityHyperLink(payload.space)}`);
          }
        } else {
          (title = `${getEntityName(payload.actor)} added ${getEntityName(payload.member)} to ${getEntityName(payload.space)}`),
            sentences.push(
              `${blockUtils.createEntityHyperLink(payload.actor)} added ${blockUtils.createEntityHyperLink(
                payload.member,
              )} to ${blockUtils.createEntityHyperLink(payload.space)}`,
            );
        }
        break;
      case 'space_membership.deleted':
        // No actor means nobody removed the member, so treat it as leaving.
        if (!payload?.actor || payload?.member?.id === payload?.actor?.id) {
          title = `${getEntityName(payload?.member)} left ${getEntityName(payload?.space)}`;
          sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} left ${blockUtils.createEntityHyperLink(payload.space)}`);
        } else {
          if (!this.isDeleted(payload)) {
            title = `${getEntityName(payload.actor)} removed ${getEntityName(payload.member)} from ${getEntityName(payload.space)}`;
            sentences.push(
              `${blockUtils.createEntityHyperLink(payload.actor)} removed ${blockUtils.createEntityHyperLink(
                payload.member,
              )} from ${blockUtils.createEntityHyperLink(payload.space)}`,
            );
          }
        }
        break;
      case 'space_join_request.created':
        title = `${getEntityName(payload.member)} requested to join ${getEntityName(payload.space)}`;
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} requested to join ${blockUtils.createEntityHyperLink(payload.space)}`);
        break;
      case 'space_join_request.accepted':
        title = `${getEntityName(payload.actor)} accepted ${getEntityName(payload.member)}'s join request to ${getEntityName(payload.space)}`;
        sentences.push(
          `${blockUtils.createEntityHyperLink(payload.actor)} accepted ${blockUtils.createEntityHyperLink(
            payload.member,
          )}'s join request to ${blockUtils.createEntityHyperLink(payload.space)}`,
        );
        break;
      case 'member_invitation.created':
        title = `${getEntityName(payload?.actor)} invited ${getEntityName(payload?.member)} to the community`;
        sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} invited ${payload?.member?.name} to the community`);
        break;
    }

    return { sentences, components, title: title };
  }

  private addImages(payload, sentences) {
    for (let i = 0; i < payload.post.imageIds.length; i++)
      sentences.push(`:camera:  [Image content](${IMAGE_SERVICE_URL}/${payload.post.imageIds[i]})`);

    return sentences;
  }

  private addAttachments(payload, sentences) {
    if (payload.post.attachments.length > 0) {
      for (let i = 0; i < payload.post.attachments.length; i++) {
        const attachment = payload.post.attachments[i];
        sentences.push(`:open_file_folder: [Download ${blockUtils.escapeText(attachment.extension)} file ](${attachment.url})`);
      }
    }

    return sentences;
  }

  private addEmbeds(payload, sentences) {
    if (payload.post?.embeds) {
      for (let embedId = 0; embedId < payload.post.embeds.length; embedId++) {
        const embed = payload.post.embeds[embedId];
        let emoji = '';
        switch (embed.type) {
          case 'video':
            emoji = ':projector:';
            break;
          case 'rich':
            emoji = ':globe_with_meridians:';
            break;
        }
        const type = embed.type.charAt(0).toUpperCase() + embed.type.slice(1);
        const title = blockUtils.escapeText(embed.title ? embed.title : `${type} Content`);
        sentences.push(`${emoji} [${title}](${encodeURI(embed.url)})`);
      }
    }
    return sentences;
  }

  private isRecentlyJoined(payload) {
    if (payload.member) {
      if (Math.abs(new Date().getTime() - new Date(payload.member.createdAt).getTime()) < MAXIMUM_TIME_FOR_DEFAULT_SPACES) {
        return true;
      }
    }
    return false;
  }
  private isDeleted(payload) {
    return payload?.member?.name === 'Deleted Member';
  }
}

export default new DiscordService();
