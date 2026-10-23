jest.mock('@/config', () => ({ CLIENT_SECRET: 'test-client-secret' }));

const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('@/utils/logger', () => ({ createLogger: () => mockLogger, logger: mockLogger }));

import express from 'express';
import request from 'supertest';
import errorMiddleware from '@middlewares/error.middleware';
import { signOAuthState } from '@/utils/auth';

const appThrowing = (error: any) => {
  const app = express();
  app.get('/fail', (req, res, next) => next(error));
  app.use(errorMiddleware);
  return app;
};

const redirect = 'https://community.example.com/manage/apps/discord';

describe('errorMiddleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends an OAuth error back to the community with the Discord code mapped to a message', async () => {
    // Arrange
    const state = signOAuthState({ networkId: 'net1', redirect });
    const app = appThrowing(Object.assign(new Error('Missing Access'), { code: 50001 }));

    // Act
    const res = await request(app).get(`/fail?state=${encodeURIComponent(state)}`);

    // Assert
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${redirect}?error=true&message=${encodeURIComponent('You have to select a public channel to make a connection')}&code=50001`);
  });

  it('reads the code from a passport oauthError', async () => {
    // Arrange
    const state = signOAuthState({ networkId: 'net1', redirect });
    const app = appThrowing({ oauthError: { data: JSON.stringify({ code: 30007, message: 'Maximum number of webhooks reached (10)' }) } });

    // Act
    const res = await request(app).get(`/fail?state=${encodeURIComponent(state)}`);

    // Assert
    expect(res.headers.location).toContain('code=30007');
    expect(res.headers.location).toContain(encodeURIComponent('Maximum number of webhooks reached (10)'));
  });

  it('answers with JSON and does not redirect for a forged state', async () => {
    // Arrange
    const forged = Buffer.from(JSON.stringify({ r: 'https://evil.test' })).toString('base64');
    const app = appThrowing(new Error('boom'));

    // Act
    const res = await request(app).get(`/fail?state=${encodeURIComponent(forged)}`);

    // Assert
    expect(res.status).toBe(500);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({ success: false, message: 'Something went wrong' });
  });
});
