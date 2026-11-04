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

describe('App body parsing', () => {
  it('accepts a signed webhook larger than the 100kb body-parser default', async () => {
    // Arrange
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc', padding: 'x'.repeat(500 * 1024) } });

    // Act
    const res = await signedPost(buildServer(), body);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ challenge: 'abc' });
  });
});
