jest.mock('@/config', () => ({
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://discord-app.test',
}));

import jwt from 'jsonwebtoken';
import {
  getNetworkHostnames,
  isSafeRedirect,
  resolveRedirect,
  signConnectToken,
  signOAuthState,
  verifyConnectToken,
  verifyOAuthState,
} from '@/utils/auth';

const context = {
  networkId: 'net1',
  memberId: 'member1',
  spaceIds: 'space1,space2',
  redirect: 'https://community.example.com/manage/apps/discord',
};

describe('connect token and oauth state', () => {
  it('round-trips a connect token', () => {
    // Arrange
    const token = signConnectToken(context);

    // Act
    const decoded = verifyConnectToken(token);

    // Assert
    expect(decoded).toEqual(context);
  });

  it('round-trips an oauth state', () => {
    // Arrange
    const state = signOAuthState(context);

    // Act
    const decoded = verifyOAuthState(state);

    // Assert
    expect(decoded).toEqual(context);
  });

  it('issues a unique nonce for every token', () => {
    // Arrange
    const first = jwt.decode(signOAuthState(context)) as jwt.JwtPayload;

    // Act
    const second = jwt.decode(signOAuthState(context)) as jwt.JwtPayload;

    // Assert
    expect(first.jti).toBeTruthy();
    expect(first.jti).not.toEqual(second.jti);
  });

  it('rejects the legacy unsigned base64 state', () => {
    // Arrange
    const forged = Buffer.from(JSON.stringify({ n: 'net1', m: 'member1', s: '', r: 'https://evil.test' }), 'ascii').toString('base64');

    // Act
    const decoded = verifyOAuthState(forged);

    // Assert
    expect(decoded).toBeNull();
  });

  it('rejects an unsigned (alg none) state', () => {
    // Arrange
    const unsigned = jwt.sign({ m: 'member1' }, '', {
      algorithm: 'none',
      subject: 'net1',
      issuer: 'tribe-discord-app',
      audience: 'tribe-discord-app:oauth-state',
    });

    // Act
    const decoded = verifyOAuthState(unsigned);

    // Assert
    expect(decoded).toBeNull();
  });

  it('rejects a state signed with another secret', () => {
    // Arrange
    const forged = jwt.sign({}, 'another-secret', {
      subject: 'net1',
      issuer: 'tribe-discord-app',
      audience: 'tribe-discord-app:oauth-state',
      expiresIn: 60,
    });

    // Act
    const decoded = verifyOAuthState(forged);

    // Assert
    expect(decoded).toBeNull();
  });

  it('rejects an expired state', () => {
    // Arrange
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, 'test-client-secret', {
      subject: 'net1',
      issuer: 'tribe-discord-app',
      audience: 'tribe-discord-app:oauth-state',
    });

    // Act
    const decoded = verifyOAuthState(expired);

    // Assert
    expect(decoded).toBeNull();
  });

  it('does not accept a connect token as an oauth state and vice versa', () => {
    // Arrange
    const token = signConnectToken(context);
    const state = signOAuthState(context);

    // Act
    const stateFromToken = verifyOAuthState(token);
    const tokenFromState = verifyConnectToken(state);

    // Assert
    expect(stateFromToken).toBeNull();
    expect(tokenFromState).toBeNull();
  });

  it('rejects the legacy settings jwt as a connect token', () => {
    // Arrange
    const legacy = jwt.sign({ sub: 'net1', aud: 'https://api.bettermode.test/graphql', iss: 'tribe-discord-app' }, 'test-client-secret', {
      expiresIn: '2d',
    });

    // Act
    const decoded = verifyConnectToken(legacy);

    // Assert
    expect(decoded).toBeNull();
  });

  it('rejects missing or non-string tokens', () => {
    // Arrange
    const inputs = [undefined, null, '', ['a'], { a: 1 }];

    // Act
    const results = inputs.map(input => verifyConnectToken(input));

    // Assert
    expect(results.every(result => result === null)).toBe(true);
  });
});

describe('redirect validation', () => {
  it('accepts https urls on an allowed host', () => {
    // Arrange
    const hosts = ['community.example.com'];

    // Act
    const result = isSafeRedirect('https://community.example.com/manage/apps/discord', hosts);

    // Assert
    expect(result).toBe(true);
  });

  it.each([
    ['another host', 'https://evil.test/'],
    ['a host suffix', 'https://community.example.com.evil.test/'],
    ['plain http', 'http://community.example.com/'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a relative url', '/manage/apps'],
    ['a protocol-relative url', '//evil.test/'],
    ['credentials in the url', 'https://user:pass@community.example.com/'],
  ])('rejects %s', (_, redirect) => {
    // Arrange
    const hosts = ['community.example.com'];

    // Act
    const result = isSafeRedirect(redirect, hosts);

    // Assert
    expect(result).toBe(false);
  });

  it('allows http on localhost for local development', () => {
    // Arrange
    const redirect = 'http://localhost:4000/manage/apps';

    // Act
    const result = isSafeRedirect(redirect);

    // Assert
    expect(result).toBe(true);
  });

  it('falls back to the primary domain when the redirect is not allowed', () => {
    // Arrange
    const hosts = ['community.example.com', 'old.example.com'];

    // Act
    const result = resolveRedirect('https://evil.test/', hosts);

    // Assert
    expect(result).toEqual('https://community.example.com/');
  });

  it('keeps a valid redirect on a secondary domain', () => {
    // Arrange
    const hosts = ['community.example.com', 'old.example.com'];

    // Act
    const result = resolveRedirect('https://old.example.com/manage/apps', hosts);

    // Assert
    expect(result).toEqual('https://old.example.com/manage/apps');
  });

  it('drops an unsafe redirect when no domain is known', () => {
    // Arrange
    const hosts: string[] = [];

    // Act
    const result = resolveRedirect('javascript:alert(1)', hosts);

    // Assert
    expect(result).toBeUndefined();
  });

  it('collects the network hostnames', () => {
    // Arrange
    const network = { domain: 'Community.Example.com', newDomain: null, domainSubfolder: 'example.com/community', aliases: ['alias.example.com'] };

    // Act
    const hosts = getNetworkHostnames(network);

    // Assert
    expect(hosts).toEqual(['community.example.com', 'example.com', 'alias.example.com']);
  });
});
