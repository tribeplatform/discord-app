jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  SIGNING_SECRET: 'test-signing-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://discord-app.test',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
}));

// Never log a bot in to Discord from the tests.
jest.mock('@/services/discord.service', () => ({
  __esModule: true,
  default: { sendDiscordMessage: jest.fn(), sendWelcomeMessage: jest.fn(), getChannelInfo: jest.fn() },
}));

import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import request from 'supertest';
import { getSignature } from '@/utils/signature';

// DB_HOST is not set, so App does not try to connect to MongoDB.
const buildServer = () => new App([new WebhookRoute(), new HealthRoute()]).getServer();

describe('App', () => {
  it('[GET] /_health responds 200', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await request(server).get('/_health');

    // Assert
    expect(res.status).toBe(200);
  });

  it('[POST] /api/webhook rejects an unsigned request', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await request(server).post('/api/webhook').send({ type: 'TEST', data: { challenge: 'abc' } });

    // Assert
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toEqual(expect.objectContaining({ status: 'SUCCEEDED' }));
  });

  it('[POST] /api/webhook answers a signed TEST challenge', async () => {
    // Arrange
    const server = buildServer();
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } });
    const timestamp = Date.now();
    const signature = getSignature({ secret: 'test-signing-secret', body, timestamp });

    // Act
    const res = await request(server)
      .post('/api/webhook')
      .set('Content-Type', 'application/json')
      .set('x-tribe-request-timestamp', String(timestamp))
      .set('x-tribe-signature', signature)
      .send(body);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'TEST', status: 'SUCCEEDED', data: { challenge: 'abc' } });
  });
});
