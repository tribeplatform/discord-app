import { NextFunction, Request, Response } from 'express';

import { Types } from '@tribeplatform/gql-client';
import { logger } from '@/utils/logger';
import incomingProfileModel from '@/models/profile.model';
import { uniq, toMap } from '@utils/util';
import { getTribeClient, listMemberByIds } from '@/utils/tribe_client';
import auth from '@/utils/auth';
import { SERVER_URL } from '@/config';
import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import discordService from '@services/discord.service'

const DEFAULT_SETTINGS = {
  webhooks: [],
  jwt: null,
  authUrl: `${SERVER_URL}/api/discord/webhook/auth`,
};

class WebhookController {
  public index = async (req: Request, res: Response, next: NextFunction) => {
    const input = req.body;

    try {
      if (input.data?.challenge) {
        return res.json({
          type: 'TEST',
          status: 'SUCCEEDED',
          data: {
            challenge: req.body?.data?.challenge,
          },
        });
      }
      let result: any = {
        type: input.type,
        status: 'SUCCEEDED',
        data: {},
      };

      switch (input.type) {
        case 'GET_SETTINGS':
          result = await this.getSettings(input);
          break;
        case 'UPDATE_SETTINGS':
          result = await this.updateSettings(input);
          break;
        case 'SUBSCRIPTION':
          result = await this.handleSubscription(input);
          break;
      }
      res.status(200).json(result);
    } catch (error) {
      logger.error(error);
      return {
        type: input.type,
        status: 'FAILED',
        data: {},
      };
    }
  };

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async getSettings(input) {
    
    const { networkId } = input;

    const currentSettings = input.currentSettings[0]?.settings || {};
    let defaultSettings;

    const webhooks = await incomingProfileModel.find({
      networkId,
    })
      .select('_id spaceIds memberId channelId channelName')
      .lean();

    switch (input.context) {
      case Types.PermissionContext.NETWORK:
        defaultSettings = DEFAULT_SETTINGS;
        break;
      default:
        defaultSettings = {};
    }

    const spaceIds = uniq(
      webhooks
        .filter(webhook => !!webhook.spaceIds.length)
        .map(webhook => webhook.spaceIds)
        .flat(),
    );

    const memberIds = uniq(webhooks.filter(webhook => !!webhook.memberId).map(webhook => webhook.memberId));

    let spaces = new Map();
    let members = new Map();
    if (spaceIds.length || memberIds.length) {
      const tribeClient = await getTribeClient({ networkId });
      spaces = toMap(await tribeClient.spaces.listByIds({ ids: spaceIds }, 'basic'), 'id');
      members = toMap(await listMemberByIds({ ids: memberIds }, tribeClient), 'id');
    }

    const settings = {
      ...defaultSettings,
      ...currentSettings,
      ...{
        webhooks: webhooks.map((webhook: IncomingProfile & { id: string; space: Types.Space; member: Types.Member }) => {
          webhook.id = webhook._id.toString();
          if (webhook?.spaceIds?.length) {
            let spaceId = webhook?.spaceIds[0];
            if (spaces.get(spaceId)) webhook.space = spaces.get(spaceId);
          }
          if (webhook?.memberId) {
            if (members.get(webhook?.memberId)) webhook.member = members.get(webhook?.memberId);
          }
          delete webhook._id;
          return webhook;
        }),
        jwt: auth.sign({ networkId }),
      },
    };

    console.log(settings);

    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: settings,
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
   private async updateSettings(input) {
    const { networkId } = input;
    const action = input?.data?.settings?.action;
    const payload = input?.data?.settings?.payload;
    console.log("update");
    console.log(action);
    console.log(networkId);

    switch (action) {
      case 'DELETE_WEBHOOK':
      case 'UPDATE_WEBHOOK':
        const _id = payload?.id;
        if (!_id) {
          return {
            type: input.type,
            status: 'FAILED',
            data: {},
          };
        }
        const webhook = await incomingProfileModel.findOne({ networkId, _id });
        if (action === 'DELETE_WEBHOOK') {
          await webhook.remove();
        } else {
          const fields = ['events', 'spaceIds']; // we are not using events for now
          for (let field of fields) {
            if (typeof payload[field] != 'undefined') webhook[field] = payload[field];
          }
          await webhook.save();
        }
        break;
    }
    const settings = this.getSettings(input);
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: settings,
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async handleSubscription(input) {

    const { networkId } = input as { networkId: string };
    const webhooks: IncomingProfile[] = await incomingProfileModel.find({
      networkId,
    }).lean();
    const { object } = input?.data as { object: any; networkId: string };
    const spaceId = object?.spaceId;
    const webhookUrls = webhooks
      .filter(webhook => {
        if (spaceId) return !webhook.spaceIds.length || webhook.spaceIds.indexOf(spaceId) !== -1;
        if (!spaceId && webhook.spaceIds.length) return false;
        return webhook;
      });

      if (webhookUrls.length) {
        const tribeClient = await getTribeClient({ networkId });
        const network = await tribeClient.network.get('all');
        const payload = {
          event: input?.data?.name,
          network,
          context: true,
        };
        let memberId: string;
        let spaceId: string;
        let postId: string;
        let actorId: string;
        switch (input?.data?.name) {
          case 'post.published':
            postId = (object as Types.Post)?.id;
            actorId = (object as Types.Post)?.createdById;
            memberId = (object as Types.Post)?.createdById;
            spaceId = (object as Types.Post)?.spaceId;
            break;
          case 'moderation.created':
          case 'moderation.accepted':
          case 'moderation.rejected':
            if (object.entityType === Types.ModerationEntityType.POST) postId = object.entityId;
            else if (object.entityType === Types.ModerationEntityType.MEMBER) memberId = object.createdById;
            spaceId = object?.spaceId;
            actorId = object?.moderatorId;
            break;
          case 'space_membership.created':
          case 'space_membership.deleted':
            memberId = object?.memberId;
            spaceId = object?.spaceId;
            actorId = input?.data?.actor?.id;
            payload.context = false;
            break;
          case 'space_join_request.created':
          case 'space_join_request.accepted':
            memberId = object?.memberId;
            spaceId = object?.spaceId;
            actorId = object?.updatedById;
            payload.context = false;
            break;
          case 'member_invitation.created':
            payload.member = {
              id: object?.id,
              email: object?.inviteeEmail,
              name: object?.inviteeName ? `${object?.inviteeName} (${object?.inviteeEmail})` : object?.inviteeEmail,
              createdAt: object?.createdAt,
              networkId: object?.networkId,
            } as Types.Member;
            actorId = object?.inviterId;
            payload.context = false;
            break;
          case 'member.verified':
            memberId = (object as Types.Member)?.id;
            payload.context = false;
            break;
        }
        if (memberId) {
          const member = await tribeClient.members.get({ id: memberId }, 'all');
          payload.member = member;
        }
        if (spaceId) {
          const space = await tribeClient.spaces.get({ id: spaceId }, 'all');
          payload.space = space;
        }
        if (actorId) {
          const actor = await tribeClient.members.get({ id: actorId }, 'all');
          payload.actor = actor;
        }
        if (postId) {
          const post = await tribeClient.posts.get({ id: postId }, 'all');
          payload.post = post;
        }
        webhookUrls.forEach(({ channelId }) => discordService.sendDiscordMessage(channelId,payload));
      } 
      
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }
}

export default WebhookController;
