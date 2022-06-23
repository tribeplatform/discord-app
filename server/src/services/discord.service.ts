import { Client, Intents, MessageEmbed } from 'discord.js';
import { Types } from '@tribeplatform/gql-client';

import { logger } from '@/utils/logger';
import * as blockUtils from '@utils/blockParser';
import * as utils from '@utils/util';

import { BOT_TOKEN } from '@/config';

const TITLE_LENGTH_LIMIT = 100;
const CONTENT_LENGTH_LIMIT = 250;
const IMAGE_SERVICE_URL = 'https://tribe-development.imgix.net';

class DiscordService {


  private client;
  private isAppReady: boolean;

  constructor() {

    this.isAppReady = false;

    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
      ],
    });

    this.client.login(BOT_TOKEN);

    this.client.once('ready', async () => {

      this.isAppReady = true;

    });


  }

  public async sendWelcomeMessage(channelId) {

    await this.client.channels.cache.get(channelId).send('Hi there, *Community Bot* is here! I would inform you on community updates in this channel.');

  }

  public async sendDiscordMessage(channelId: string, payload: any) {

    try {
      const dataToSend = new MessageEmbed()
        .setColor('#0099ff')
        .setAuthor({
          name: payload.network?.name,
          iconURL: (payload.network?.favicon as Types.Image)?.urls?.small,
          url: `https://${payload.network.domain}`,
        })
        .setThumbnail(payload.member.profilePicture.url)
        .setTimestamp()
        .setFooter({ text: `Space: ${payload.space.name}`, iconURL: payload.space.banner?.url });

      let { sentences, components } = this.sentenceBuilder(payload);

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

          // to remove unwanted links
          const filteredSentences = [];
          const dataLines = parsed.split('\n');
          for (let lines = 0; lines < dataLines.length; lines++) {
            if (!dataLines[lines].startsWith('![]'))
              if (dataLines[lines].startsWith('>'))// remove quote
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


      // if(payload.post.imageIds.length)
      //     dataToSend.setImage(`${imageServiceUrl}/${payload.post.imageIds[0]}`)

      dataToSend.setDescription(sentences.join('\n\n'));


      await this.client.channels.cache.get(channelId).send({
        embeds: [dataToSend],
        components,
      });

    } catch (e) {

      logger.error(e);

    }
  }

  private sentenceBuilder(payload: any): { sentences: string[], components: any [] } {

    const sentences: string[] = [];
    const components: any[] = [];

    switch (payload.event) {
      case 'post.published':
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} added a ${payload.post.repliedToId ? 'reply to:' : 'post to:'}`);
        break;
      case 'member.verified':
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} joined the community`);
        break;
      case 'moderation.created':
        components.push({
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: 'Go to moderation',
              url: `https://${payload.network.domain}/settings/moderation`,
            },
          ],
        });
        if (payload.post) {
          sentences.push(`A post flagged for moderation`);
        } else sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} was flagged for moderation`);
        break;
      case 'moderation.rejected':
        if (payload.post) {
          sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} approved this post`);
        }
        break;
      case 'moderation.accepted':
        if (payload.post) {
          sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} rejected this post`);
        }
        break;
      case 'space_membership.created':
        if (payload?.member?.id === payload?.actor?.id) {
          sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} joined ${blockUtils.createEntityHyperLink(payload.space)}`);
        } else {
          sentences.push(
            `${blockUtils.createEntityHyperLink(payload.actor)} added ${blockUtils.createEntityHyperLink(
              payload.member,
            )} to ${blockUtils.createEntityHyperLink(payload.space)}`,
          );
        }
        break;
      case 'space_membership.deleted':
        if (payload?.member?.id === payload?.actor?.id) {
          sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} left ${blockUtils.createEntityHyperLink(payload.space)}`);
        } else {
          sentences.push(
            `${blockUtils.createEntityHyperLink(payload.actor)} removed ${blockUtils.createEntityHyperLink(
              payload.member,
            )} from ${blockUtils.createEntityHyperLink(payload.space)}`,
          );
        }
        break;
      case 'space_join_request.created':
        sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} requested to join ${blockUtils.createEntityHyperLink(payload.space)}`);
        break;
      case 'space_join_request.accepted':
        sentences.push(
          `${blockUtils.createEntityHyperLink(payload.actor)} accepted ${blockUtils.createEntityHyperLink(
            payload.member,
          )}'s join request to ${blockUtils.createEntityHyperLink(payload.space)}`,
        );
        break;
      case 'member_invitation.created':
        sentences.push(`${blockUtils.createEntityHyperLink(payload.actor)} invited ${payload?.member?.name} to the community`);
        break;
    }

    return { sentences, components };
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
        const title = blockUtils.escapeText((embed.title) ? embed.title : `${type} Content`);
        sentences.push(`${emoji} [${title}](${encodeURI(embed.url)})`);
      }
    }
    return sentences;

  }
}

export default new DiscordService();
