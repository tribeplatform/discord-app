import { Client, Intents, MessageEmbed } from 'discord.js'
import { Types } from '@tribeplatform/gql-client';
import * as fs from 'fs'

import { logger } from '@/utils/logger';
import * as blockUtils from '@utils/blockParser';
import * as utils from '@utils/util';

import { BOT_TOKEN }  from '@/config'

class DiscordService {

    private client;
    private isAppReady: boolean;

    constructor(){

        this.isAppReady = false;

        this.client = new Client({ intents: [
            Intents.FLAGS.GUILDS,
            Intents.FLAGS.GUILD_MESSAGES
        ] });
        this.client.login(BOT_TOKEN);

        this.client.once('ready', async () => {

            this.isAppReady = true;

        });

        
    }

    public async sendWelcomeMessage(channelId){

        await this.client.channels.cache.get(channelId).send('Hi there, *Community Bot* is here! I would inform you on community updates in this channel.')
    
    }

    public async sendDiscordMessage(channelId: string, payload) {

        const imageServiceUrl = 'https://tribe-development.imgix.net'

        const sentences : string[] = [];

        try{
            fs.writeFileSync("test.json",JSON.stringify(payload, null, 2))
            const dataToSend =  new MessageEmbed()
            .setColor('#0099ff')
            .setAuthor({ name:payload.network?.name, iconURL:(payload.network?.favicon as Types.Image)?.urls?.small, url:`https://${payload.network.domain}`})
            .setThumbnail(payload.member.profilePicture.url)
            .setTimestamp()
            .setFooter({ text: `Space: ${payload.space.name}`, iconURL: payload.space.banner?.url });
        
            switch (payload.event) {
                case 'post.published':
                  sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} added a ${payload.post.repliedToId ? 'reply' : 'post'}`);
                  break;
                case 'member.verified':
                  sentences.push(`${blockUtils.createEntityHyperLink(payload.member)} joined the community`);
                  break;
                case 'moderation.created':
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

              const text = sentences[0];
              sentences[0] = ':bell: ' + text;
              if (payload.post) {
                const parent = payload.post?.repliedTos?.length ? payload.post?.repliedTos.find(post => !post.repliedToId) : payload.post;
                if (parent?.title) {
                  sentences[0] =
                    sentences[0] +
                    '\n\n ' +
                    blockUtils.createHyperlink({
                      text: parent.title,
                      url: payload.post.url,
                    });
                }
                if (payload.post.shortContent) {
                  let parsed = blockUtils.parseHtml(utils.transformMentions(payload.post.shortContent, `https://${payload.network.domain}/member/`));
                  
                  const filteredSentences = [];
                  const dataLines = parsed.split("\n")
                  for(let lines = 0; lines < dataLines.length ; lines++){
                      if(!dataLines[lines].startsWith("![]"))
                      filteredSentences.push(dataLines[lines])
                  }

                  parsed = filteredSentences.join("\n")
                  
                  if (parsed && parsed.length) sentences.push(blockUtils.createQuote(parsed));

                  for(let i = 0;i < payload.post.imageIds.length; i++)
                  sentences.push(`:camera:  [Image content](${imageServiceUrl}/${payload.post.imageIds[i]})`)

                  if(payload.post.embeds){
                    for(let embedId = 0; embedId < payload.post.embeds.length ; embedId++){
                        const embed = payload.post.embeds[embedId];
                        let emoji = "";
                        switch(embed.type){
                            case "video":
                                emoji = ":projector:"
                                break;
                            case "rich":
                                emoji = ":globe_with_meridians:"
                                break;
                        }
                        const type = embed.type.charAt(0).toUpperCase() + embed.type.slice(1);
                        const title = blockUtils.escapeText((embed.title)? embed.title : `${type} Content`)
                        sentences.push(`${emoji} [${title}](${encodeURI(embed.url)})`)
                    } 
                  }

                  if(payload.post.attachments.length > 0){
                    for(let i = 0;i <payload.post.attachments.length; i++) {
                        const attachemnt = payload.post.attachments[i];
                        sentences.push(`:open_file_folder: [Download ${blockUtils.escapeText(attachemnt.extension)} file ](${attachemnt.url})`)
                    }
                  }
                }
            }
            

            // if(payload.post.imageIds.length)
            //     dataToSend.setImage(`${imageServiceUrl}/${payload.post.imageIds[0]}`)

            dataToSend.setDescription(sentences.join("\n\n"))
                
            console.log({name:payload.network?.name, iconURL:(payload.network?.favicon as Types.Image)?.urls?.small, url:payload.network.domain});

            await this.client.channels.cache.get(channelId).send({embeds: [dataToSend] })//'985644946830794803'

        }catch(e){

            logger.error(e);

        }
      }

}

export default new DiscordService()