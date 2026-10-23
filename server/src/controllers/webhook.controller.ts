import { NextFunction, Request, Response } from 'express';

import { MemberFields, PostFields, SpaceFields, Types } from '@tribeplatform/gql-client';
import { createLogger, logger } from '@/utils/logger';
import incomingProfileModel from '@/models/profile.model';
import { uniq, toMap } from '@utils/util';
import { getNetwork, getSpace, getTribeClient, listMemberByIds } from '@/utils/tribe_client';
import { getNetworkHostnames, resolveRedirect, signConnectToken } from '@/utils/auth';
import { SERVER_URL } from '@/config';
import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import discordService from '@services/discord.service';
import profileModel from '@/models/profile.model';
import { Payload } from '@/type/payload.type';
import { UpdateAction } from '@/enums/update-action.enum';
import { WebhookResponse } from '@/dto/webhook-response.dto';
import { Logger } from '@tribeplatform/node-logger';

const AUTH_URL = `${SERVER_URL}/api/discord/webhook/auth`;

const DEFAULT_SETTINGS = {
  webhooks: [],
  authUrl: AUTH_URL,
};

// Only request what the Discord embeds read; broad presets break when the API drops fields
// Member: name, url, createdAt (base fields) and the profile picture for the thumbnail
export const MEMBER_FIELDS: MemberFields = { profilePicture: 'basic' };
// Space: name, url (base fields) and the banner for the footer icon
export const SPACE_FIELDS: SpaceFields = { banner: 'basic' };
// Post: title, url, shortContent, imageIds, repliedToId (base fields), plus embeds, attachments and the parent post title
export const POST_FIELDS: PostFields = { embeds: 'basic', attachments: 'basic', repliedTos: {} };

// Credentials must never be part of GET_SETTINGS: its output is readable by any member and guest of the community.
const SECRET_SETTING_KEYS = ['jwt', 'connectUrl'];

class WebhookController {
  private readonly logger: Logger
  constructor() {
    this.logger = createLogger(WebhookController.name)
  }
  public index = async (req: Request, res: Response, next: NextFunction): Promise<WebhookResponse | any> => {
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

      this.logger.log(`Incoming webhook type=${input?.type} networkId=${input?.networkId} event=${input?.data?.name || ''}`);

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
        case 'APP_UNINSTALLED':
          result = await this.uninstall(input);
          break;
      }
      res.status(200).json(result);
    } catch (error) {
      this.logger.error(error);
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
  private async getSettings(input): Promise<WebhookResponse> {
    const { networkId } = input;

    const currentSettings = input.currentSettings[0]?.settings || {};
    let defaultSettings;

    const webhooks = await incomingProfileModel
      .find({
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
      },
    };
    for (const key of SECRET_SETTING_KEYS) delete settings[key];

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
  private async updateSettings(input): Promise<WebhookResponse> {
    const { networkId } = input;
    const action: UpdateAction = input?.data?.settings?.action;
    const payload: any = input?.data?.settings?.payload;

    switch (action) {
      case UpdateAction.GET_CONNECT_URL:
        return this.getConnectUrl(input);
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

    // Nothing is returned in `data.toStore`, so Bettermode does not persist anything for these actions.
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }

  /**
   * Issues a short-lived URL that starts the Discord OAuth flow for the network.
   * UPDATE_SETTINGS is only callable by network admins and its `data` (outside `toStore`) is returned to the caller only.
   */
  private async getConnectUrl(input): Promise<WebhookResponse> {
    const { networkId } = input;
    const payload = input?.data?.settings?.payload || {};
    if (typeof payload.memberId !== 'string' || !payload.memberId.length) {
      return {
        type: input.type,
        status: 'FAILED',
        errorMessage: '"memberId" is required to connect a Discord channel.',
        data: {},
      };
    }
    const spaceIds = Array.isArray(payload.spaceIds)
      ? payload.spaceIds.filter(id => typeof id === 'string' && id.length).join(',')
      : typeof payload.spaceIds === 'string'
      ? payload.spaceIds
      : undefined;
    let hostnames: string[] = [];
    try {
      const tribeClient = await getTribeClient({ networkId });
      hostnames = getNetworkHostnames(await tribeClient.network.get('basic'));
    } catch (err) {
      this.logger.error(`Unable to load the network domains for networkId=${networkId}`);
    }
    const token = signConnectToken({
      networkId,
      memberId: payload.memberId,
      spaceIds: spaceIds || undefined,
      redirect: resolveRedirect(payload.redirect, hostnames),
    });
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {
        connectUrl: `${AUTH_URL}?jwt=${encodeURIComponent(token)}`,
      },
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async handleSubscription(input): Promise<WebhookResponse> {
    const { networkId } = input as { networkId: string };
    const webhooks: IncomingProfile[] = await incomingProfileModel
      .find({
        networkId,
      })
      .lean();

    const { object } = input?.data as { object: any; networkId: string };
    const spaceId = object?.spaceId;
    const webhookUrls = webhooks.filter(webhook => {
      if (spaceId) return !webhook.spaceIds.length || webhook.spaceIds.indexOf(spaceId) !== -1;
      if (!spaceId && webhook.spaceIds.length) return false;
      return webhook;
    });

    if (webhookUrls.length) {
      const tribeClient = await getTribeClient({ networkId });
      const network = await getNetwork(networkId, tribeClient);
      const payload: Payload = {
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
        const member = await tribeClient.members.get({ id: memberId }, MEMBER_FIELDS);
        payload.member = member;
      }
      if (spaceId) {
        payload.space = await getSpace(networkId, spaceId, SPACE_FIELDS, tribeClient);
      }
      if (actorId) {
        // post.published (the most common event) has the author as both member and actor; don't fetch it twice.
        payload.actor =
          actorId === memberId && payload.member ? payload.member : await tribeClient.members.get({ id: actorId }, MEMBER_FIELDS);
      }
      if (postId) {
        const post = await tribeClient.posts.get({ id: postId }, POST_FIELDS);
        payload.post = post;
      }
      webhookUrls.forEach(({ channelId }) => discordService.sendDiscordMessage(channelId, payload));
    }

    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async uninstall(input): Promise<WebhookResponse> {
    const { networkId } = input as { networkId: string };
    await profileModel
      .deleteMany({
        networkId,
      })
      .lean();
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }
}

export default WebhookController;
