jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  SIGNING_SECRET: 'test-signing-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://discord-app.test',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
}));

const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('@/utils/logger', () => ({ createLogger: () => mockLogger, logger: mockLogger }));

jest.mock('@/services/discord.service', () => ({
  __esModule: true,
  default: { sendDiscordMessage: jest.fn(), sendWelcomeMessage: jest.fn(), getChannelInfo: jest.fn() },
}));

import App from '@/app';
import WebhookRoute from '@routes/webhook.route';
import request from 'supertest';
import { getSignature } from '@/utils/signature';

// DB_HOST is not set, so App does not try to connect to MongoDB.
const buildServer = () => new App([new WebhookRoute()]).getServer();

const signedPost = (server, body: string, timestamp = Date.now()) =>
  request(server)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-tribe-request-timestamp', String(timestamp))
    .set('x-tribe-signature', getSignature({ secret: 'test-signing-secret', body, timestamp }))
    .send(body);

describe('App error handling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers an unsigned webhook with 403, not 500', async () => {
    // Act
    const res = await request(buildServer()).post('/api/webhook').send({ type: 'TEST', data: { challenge: 'abc' } });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'The x-tribe-signature is not valid.' });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('answers a stale signature with 403', async () => {
    // Arrange
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } });

    // Act
    const res = await signedPost(buildServer(), body, Date.now() - 10 * 60 * 1000);

    // Assert
    expect(res.status).toBe(403);
  });
});
