jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://discord-app.test',
}));

const mockLog = jest.fn();
jest.mock('@/utils/logger', () => {
  const instance = { log: (...args) => mockLog(...args), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { createLogger: () => instance, logger: instance };
});

jest.mock('@/services/discord.service', () => ({
  __esModule: true,
  default: { sendDiscordMessage: jest.fn(), sendWelcomeMessage: jest.fn(), getChannelInfo: jest.fn() },
}));

jest.mock('@/models/profile.model', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

jest.mock('@/utils/tribe_client', () => ({
  getTribeClient: jest.fn(),
  listMemberByIds: jest.fn(async () => []),
}));

import { memberGQLFields, postGQLFields, spaceGQLFields } from '@tribeplatform/gql-client';
import profileModel from '@/models/profile.model';
import { getTribeClient } from '@/utils/tribe_client';
import discordService from '@/services/discord.service';
import WebhookController, { MEMBER_FIELDS, POST_FIELDS, SPACE_FIELDS } from '@/controllers/webhook.controller';
import { verifyConnectToken } from '@/utils/auth';

const mockedModel = profileModel as unknown as Record<string, jest.Mock>;
const mockedGetTribeClient = getTribeClient as jest.Mock;
const mockedSendDiscordMessage = discordService.sendDiscordMessage as jest.Mock;

const squash = (selection: string) => selection.replace(/\s+/g, ' ');

const storedWebhooks = () => [
  {
    _id: { toString: () => 'webhook1' },
    channelId: 'C1',
    channelName: 'general',
    spaceIds: [],
  },
];

const call = async (controller: WebhookController, body: any) => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  await controller.index({ body } as any, res, jest.fn());
  return res.json.mock.calls[0]?.[0];
};

const network = {
  id: 'net1',
  domain: 'community.example.com',
  newDomain: null,
  domainSubfolder: null,
  aliases: [],
};

describe('WebhookController', () => {
  const controller = new WebhookController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedModel.find.mockReturnValue({ select: () => ({ lean: async () => storedWebhooks() }), lean: async () => storedWebhooks() });
    mockedGetTribeClient.mockResolvedValue({ network: { get: jest.fn(async () => network) } });
  });

  describe('GET_SETTINGS', () => {
    it('never returns a connect credential', async () => {
      // Arrange
      const body = {
        type: 'GET_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [{ settings: { jwt: 'stored-legacy-jwt', connectUrl: 'https://discord-app.test/x' } }],
      };

      // Act
      const result = await call(controller, body);

      // Assert
      expect(result.status).toEqual('SUCCEEDED');
      expect(result.data).not.toHaveProperty('jwt');
      expect(result.data).not.toHaveProperty('connectUrl');
      expect(result.data.authUrl).toEqual('https://discord-app.test/api/discord/webhook/auth');
      expect(result.data.webhooks).toEqual([expect.objectContaining({ id: 'webhook1', channelName: 'general' })]);
      expect(JSON.stringify(result)).not.toMatch(/eyJ/);
    });
  });

  describe('UPDATE_SETTINGS', () => {
    it('returns a short-lived connect url outside toStore', async () => {
      // Arrange
      const body = {
        type: 'UPDATE_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [],
        data: {
          settings: {
            action: 'GET_CONNECT_URL',
            payload: { memberId: 'member1', spaceIds: ['space1'], redirect: 'https://community.example.com/manage/apps/discord' },
          },
        },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      expect(result.status).toEqual('SUCCEEDED');
      expect(result.data).not.toHaveProperty('toStore');
      expect(Object.keys(result.data)).toEqual(['connectUrl']);
      const url = new URL(result.data.connectUrl);
      expect(`${url.origin}${url.pathname}`).toEqual('https://discord-app.test/api/discord/webhook/auth');
      expect(verifyConnectToken(url.searchParams.get('jwt'))).toEqual({
        networkId: 'net1',
        memberId: 'member1',
        spaceIds: 'space1',
        redirect: 'https://community.example.com/manage/apps/discord',
      });
      expect(mockedModel.create).not.toHaveBeenCalled();
      expect(mockedModel.findOne).not.toHaveBeenCalled();
      expect(mockedModel.deleteMany).not.toHaveBeenCalled();
    });

    it('replaces a redirect outside the network domains', async () => {
      // Arrange
      const body = {
        type: 'UPDATE_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [],
        data: { settings: { action: 'GET_CONNECT_URL', payload: { memberId: 'member1', redirect: 'https://evil.test/' } } },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      const token = new URL(result.data.connectUrl).searchParams.get('jwt');
      expect(verifyConnectToken(token)?.redirect).toEqual('https://community.example.com/');
    });

    it('still returns a connect url when the network lookup fails', async () => {
      // Arrange
      mockedGetTribeClient.mockRejectedValue(new Error('unavailable'));
      const body = {
        type: 'UPDATE_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [],
        data: { settings: { action: 'GET_CONNECT_URL', payload: { memberId: 'member1', redirect: 'https://community.example.com/x' } } },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      const token = new URL(result.data.connectUrl).searchParams.get('jwt');
      expect(verifyConnectToken(token)).toEqual({ networkId: 'net1', memberId: 'member1', redirect: 'https://community.example.com/x' });
    });

    it('fails early without a member id', async () => {
      // Arrange
      const body = {
        type: 'UPDATE_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [],
        data: { settings: { action: 'GET_CONNECT_URL', payload: { redirect: 'https://community.example.com/x' } } },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      expect(result.status).toEqual('FAILED');
      expect(result.data).toEqual({});
    });

    it('keeps deleting connections without storing settings', async () => {
      // Arrange
      const webhook = { remove: jest.fn(async () => undefined) };
      mockedModel.findOne.mockResolvedValue(webhook);
      const body = {
        type: 'UPDATE_SETTINGS',
        networkId: 'net1',
        context: 'NETWORK',
        currentSettings: [],
        data: { settings: { action: 'DELETE_WEBHOOK', payload: { id: 'webhook1' } } },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      expect(mockedModel.findOne).toHaveBeenCalledWith({ networkId: 'net1', _id: 'webhook1' });
      expect(webhook.remove).toHaveBeenCalled();
      expect(result).toEqual({ type: 'UPDATE_SETTINGS', status: 'SUCCEEDED', data: {} });
    });
  });

  describe('SUBSCRIPTION', () => {
    const subscriptionClient = () => ({
      network: { get: jest.fn(async () => network) },
      members: { get: jest.fn(async ({ id }) => ({ id, name: `Member ${id}`, url: `https://community.example.com/member/${id}` })) },
      spaces: { get: jest.fn(async ({ id }) => ({ id, name: 'General', url: 'https://community.example.com/s/general' })) },
      posts: { get: jest.fn(async ({ id }) => ({ id, title: 'Hello', imageIds: [], embeds: [], attachments: [] })) },
    });

    it('fetches the post, author and space with narrow field selections', async () => {
      // Arrange
      const client = subscriptionClient();
      mockedGetTribeClient.mockResolvedValue(client);
      const body = {
        type: 'SUBSCRIPTION',
        networkId: 'net1',
        data: { name: 'post.published', object: { id: 'post1', createdById: 'member1', spaceId: 'space1' } },
      };

      // Act
      const result = await call(controller, body);

      // Assert
      expect(result.status).toEqual('SUCCEEDED');
      expect(client.posts.get).toHaveBeenCalledWith({ id: 'post1' }, POST_FIELDS);
      expect(client.spaces.get).toHaveBeenCalledWith({ id: 'space1' }, SPACE_FIELDS);
      expect(client.members.get).toHaveBeenCalledWith({ id: 'member1' }, MEMBER_FIELDS);
      expect(client.members.get).toHaveBeenCalledTimes(2);
      expect(mockedSendDiscordMessage).toHaveBeenCalledWith(
        'C1',
        expect.objectContaining({
          event: 'post.published',
          post: expect.objectContaining({ id: 'post1' }),
          member: expect.objectContaining({ id: 'member1' }),
          actor: expect.objectContaining({ id: 'member1' }),
          space: expect.objectContaining({ id: 'space1' }),
        }),
      );
    });

    it('fetches the member, actor and space of a space join with narrow field selections', async () => {
      // Arrange
      const client = subscriptionClient();
      mockedGetTribeClient.mockResolvedValue(client);
      const body = {
        type: 'SUBSCRIPTION',
        networkId: 'net1',
        data: { name: 'space_membership.created', actor: { id: 'admin1' }, object: { memberId: 'member1', spaceId: 'space1' } },
      };

      // Act
      await call(controller, body);

      // Assert
      expect(client.members.get.mock.calls).toEqual([
        [{ id: 'member1' }, MEMBER_FIELDS],
        [{ id: 'admin1' }, MEMBER_FIELDS],
      ]);
      expect(client.spaces.get).toHaveBeenCalledWith({ id: 'space1' }, SPACE_FIELDS);
      expect(client.posts.get).not.toHaveBeenCalled();
    });

    it('never requests a broad preset', async () => {
      // Arrange
      const client = subscriptionClient();
      mockedGetTribeClient.mockResolvedValue(client);
      const body = {
        type: 'SUBSCRIPTION',
        networkId: 'net1',
        data: { name: 'moderation.rejected', object: { entityType: 'POST', entityId: 'post1', spaceId: 'space1', moderatorId: 'admin1' } },
      };

      // Act
      await call(controller, body);

      // Assert
      const presets = ['basic', 'all', 'default'];
      for (const get of [client.members.get, client.spaces.get, client.posts.get] as jest.Mock[]) {
        expect(get).toHaveBeenCalled();
        for (const [, fields] of get.mock.calls) expect(presets).not.toContain(fields);
      }
    });

    it('requests the member fields the Discord message shows and nothing heavier', () => {
      // Act
      const selection = squash(memberGQLFields(MEMBER_FIELDS));

      // Assert
      for (const field of [' id ', ' name ', ' url ', ' createdAt ', 'profilePicture {']) expect(selection).toContain(field);
      for (const field of ['sessions', 'activeSession', 'blockedMembers', 'authMemberProps', 'badges', 'settings', 'score']) {
        expect(selection).not.toContain(field);
      }
    });

    it('requests the space fields the Discord message shows and nothing heavier', () => {
      // Act
      const selection = squash(spaceGQLFields(SPACE_FIELDS));

      // Assert
      for (const field of [' id ', ' name ', ' url ', 'banner {']) expect(selection).toContain(field);
      for (const field of ['slate {', 'createdBy {', 'authMemberProps', 'seoDetail {', 'highlightedTags', 'collection {']) {
        expect(selection).not.toContain(field);
      }
    });

    it('requests the post fields the Discord message shows and nothing heavier', () => {
      // Act
      const selection = squash(postGQLFields(POST_FIELDS));

      // Assert
      for (const field of [' title ', ' url ', ' shortContent ', ' imageIds ', ' repliedToId ', 'embeds {', 'attachments {', 'repliedTos {']) {
        expect(selection).toContain(field);
      }
      for (const field of ['owner {', 'createdBy {', 'reactions {', 'replies(', 'mentions {', 'space {', 'repliedTo {', 'authMemberProps']) {
        expect(selection).not.toContain(field);
      }
      const parent = selection.slice(selection.indexOf('repliedTos {'));
      expect(parent).toContain(' title ');
      expect(parent).toContain(' repliedToId ');
    });
  });

  it('does not log the webhook payload', async () => {
    // Arrange
    const body = {
      type: 'GET_SETTINGS',
      networkId: 'net1',
      context: 'NETWORK',
      currentSettings: [{ settings: { secretValue: 'do-not-log-me' } }],
    };

    // Act
    await call(controller, body);

    // Assert
    expect(mockLog).toHaveBeenCalled();
    expect(JSON.stringify(mockLog.mock.calls)).not.toContain('do-not-log-me');
  });
});
