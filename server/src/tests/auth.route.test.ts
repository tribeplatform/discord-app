jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://discord-app.test',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
}));

jest.mock('@/services/discord.service', () => ({
  __esModule: true,
  default: { sendDiscordMessage: jest.fn(), sendWelcomeMessage: jest.fn(), getChannelInfo: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import AuthRoute from '@routes/auth.route';
import passportMiddleware from '@middlewares/passport.middleware';
import { signConnectToken, signOAuthState, verifyOAuthState } from '@/utils/auth';

const buildApp = () => {
  const app = express();
  passportMiddleware.init(app);
  app.use(new AuthRoute().router);
  return app;
};

describe('Discord auth routes', () => {
  const context = { networkId: 'net1', memberId: 'member1', redirect: 'https://community.example.com/manage/apps/discord' };

  it('redirects to Discord with a signed state and the registered callback url', async () => {
    // Arrange
    const app = buildApp();
    const token = signConnectToken(context);

    // Act
    const res = await request(app).get(`/api/discord/webhook/auth?jwt=${encodeURIComponent(token)}`);

    // Assert
    expect(res.status).toEqual(302);
    const location = new URL(res.headers.location);
    expect(location.hostname).toEqual('discord.com');
    expect(location.searchParams.get('client_id')).toEqual('discord-client-id');
    expect(location.searchParams.get('redirect_uri')).toEqual('https://discord-app.test/api/discord/webhook/auth/callback');
    expect(verifyOAuthState(location.searchParams.get('state'))).toEqual(context);
  });

  it('rejects starting the flow without a valid connect token', async () => {
    // Arrange
    const app = buildApp();

    // Act
    const res = await request(app).get('/api/discord/webhook/auth?jwt=invalid');

    // Assert
    expect(res.status).toEqual(403);
  });

  it('rejects a callback with a forged state before exchanging the code', async () => {
    // Arrange
    const app = buildApp();
    const forged = Buffer.from(JSON.stringify({ n: 'net1', m: 'member1', s: '', r: 'https://evil.test' }), 'ascii').toString('base64');

    // Act
    const res = await request(app).get(`/api/discord/webhook/auth/callback?code=abc&state=${encodeURIComponent(forged)}`);

    // Assert
    expect(res.status).toEqual(403);
    expect(res.headers.location).toBeUndefined();
  });

  it('sends a cancelled authorization back to the community', async () => {
    // Arrange
    const app = buildApp();
    const state = signOAuthState(context);

    // Act
    const callback = await request(app).get(`/api/discord/webhook/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    const failure = await request(app).get(callback.headers.location);

    // Assert
    expect(callback.status).toEqual(302);
    expect(failure.status).toEqual(302);
    expect(failure.headers.location.startsWith(`${context.redirect}?error=true&message=`)).toBe(true);
  });

  it('does not redirect to an arbitrary community_url on failure', async () => {
    // Arrange
    const app = buildApp();

    // Act
    const res = await request(app).get('/api/discord/webhook/auth/callback/failure?community_url=https://evil.test');

    // Assert
    expect(res.headers.location).toBeUndefined();
  });
});
