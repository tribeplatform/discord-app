jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  SERVER_URL: 'https://discord-app.test',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
}));

const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('@/utils/logger', () => ({ createLogger: () => mockLogger, logger: mockLogger }));

let mockVerify: (...args: any[]) => Promise<void>;
jest.mock('passport-discord', () => ({
  Strategy: jest.fn().mockImplementation((options, verify) => {
    mockVerify = verify;
    return { name: 'discord', authenticate: jest.fn() };
  }),
}));

const mockInsert = jest.fn();
jest.mock('@/repositories/discord.repository', () => ({ __esModule: true, default: { insertProfileData: (...args: any[]) => mockInsert(...args) } }));

const mockSendWelcomeMessage = jest.fn();
const mockGetChannelInfo = jest.fn();
jest.mock('@/services/discord.service', () => ({
  __esModule: true,
  default: { sendWelcomeMessage: (...args: any[]) => mockSendWelcomeMessage(...args), getChannelInfo: (...args: any[]) => mockGetChannelInfo(...args) },
}));

import express from 'express';
import passportMiddleware from '@middlewares/passport.middleware';
import { signOAuthState } from '@/utils/auth';

const params = { webhook: { id: 'W1', channel_id: 'C1', token: 'webhook-token' } };

const runVerify = async (overrides: Record<string, any> = {}) => {
  const req = { query: { state: signOAuthState({ networkId: 'net1', memberId: 'member1' }) } };
  const done = jest.fn();
  await mockVerify(req, 'access', 'refresh', { ...params, ...overrides }, { id: 'U1' }, done);
  return done;
};

describe('Discord OAuth verify callback', () => {
  beforeAll(() => passportMiddleware.init(express()));

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockImplementation(async doc => doc);
    mockGetChannelInfo.mockResolvedValue({ name: 'general' });
    mockSendWelcomeMessage.mockResolvedValue(undefined);
  });

  it('saves the connection and sends the welcome message', async () => {
    // Act
    const done = await runVerify();

    // Assert
    expect(mockSendWelcomeMessage).toHaveBeenCalledWith('C1');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'net1', memberId: 'member1', channelId: 'C1', channelName: 'general' }));
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ channelId: 'C1' }));
  });

  it('fails the flow without an error when Discord returns no channel webhook', async () => {
    // Act
    const done = await runVerify({ webhook: undefined });

    // Assert
    expect(mockInsert).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, false);
  });

  it('still saves the connection when the channel name cannot be loaded', async () => {
    // Arrange
    mockGetChannelInfo.mockRejectedValue(new Error('Missing Access'));

    // Act
    const done = await runVerify();

    // Assert
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ channelId: 'C1' }));
  });

  it("passes Discord's error on when the bot cannot post in the channel", async () => {
    // Arrange
    const error = Object.assign(new Error('Missing Access'), { code: 50001 });
    mockSendWelcomeMessage.mockRejectedValue(error);

    // Act
    const done = await runVerify();

    // Assert
    expect(mockInsert).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(error);
  });

  it('fails instead of reporting success when the connection could not be saved', async () => {
    // Arrange
    mockInsert.mockResolvedValue(undefined);

    // Act
    const done = await runVerify();

    // Assert
    expect(done).toHaveBeenCalledWith(expect.any(Error));
  });
});
