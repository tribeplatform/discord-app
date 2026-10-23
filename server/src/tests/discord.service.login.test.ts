jest.mock('@/config', () => ({
  BOT_TOKEN: 'test-bot-token',
}));

const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
const mockCreateLogger = jest.fn(() => mockLogger);
jest.mock('@/utils/logger', () => ({ createLogger: mockCreateLogger, logger: mockLogger }));

// The module-level singleton gets a client that logs in fine; each test builds its own service.
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => ({ login: jest.fn(async () => 'ok'), on: jest.fn(), channels: { cache: new Map() } })),
  };
});

import { EventEmitter } from 'events';
import { DiscordService, getLoginRetryDelay, LOGIN_RETRY_BASE_MS, LOGIN_RETRY_MAX_MS } from '@/services/discord.service';

const flush = () => new Promise(resolve => setImmediate(resolve));
// Lets the pending login promise chain settle while fake timers are installed.
const pump = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const fakeClient = (login: jest.Mock) => {
  const client: any = new EventEmitter();
  client.login = login;
  client.channels = { cache: new Map(), fetch: jest.fn() };
  return client;
};

const payload = {
  event: 'member.verified',
  network: { id: 'net1', name: 'Community', domain: 'community.test' },
  member: { id: 'm1', name: 'Ada', url: 'https://community.test/member/m1', createdAt: new Date(0).toISOString() },
};

const readyService = () => {
  const client = fakeClient(jest.fn(async () => 'ok'));
  const service = new DiscordService(client);
  client.emit('ready');
  return { client, service };
};

describe('DiscordService login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('does not create a logger per instance', () => {
    fakeClient(jest.fn(async () => 'ok'));
    new DiscordService(fakeClient(jest.fn(async () => 'ok')));
    new DiscordService(fakeClient(jest.fn(async () => 'ok')));
    expect(mockCreateLogger).not.toHaveBeenCalled();
  });

  it('logs a rejected token instead of crashing, and never logs the token', async () => {
    // Arrange
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const error = Object.assign(new Error('An invalid token was provided.'), { code: 'TOKEN_INVALID' });

    // Act
    new DiscordService(fakeClient(jest.fn().mockRejectedValue(error)));
    await flush();
    process.off('unhandledRejection', unhandled);

    // Assert
    expect(unhandled).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('TOKEN_INVALID'));
    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain('test-bot-token');
  });

  it('retries the login with an increasing delay', async () => {
    // Arrange
    jest.useFakeTimers();
    const login = jest.fn().mockRejectedValueOnce(new Error('gateway down')).mockRejectedValueOnce(new Error('gateway down')).mockResolvedValue('ok');

    // Act
    new DiscordService(fakeClient(login));
    await pump();
    jest.advanceTimersByTime(LOGIN_RETRY_BASE_MS - 1);
    const callsBeforeFirstRetry = login.mock.calls.length;
    jest.advanceTimersByTime(1);
    await pump();
    jest.advanceTimersByTime(2 * LOGIN_RETRY_BASE_MS - 1);
    const callsBeforeSecondRetry = login.mock.calls.length;
    jest.advanceTimersByTime(1);
    await pump();

    // Assert
    expect(callsBeforeFirstRetry).toBe(1);
    expect(callsBeforeSecondRetry).toBe(2);
    expect(login).toHaveBeenCalledTimes(3);
  });

  it('caps the retry delay', () => {
    expect(getLoginRetryDelay(0)).toBe(LOGIN_RETRY_BASE_MS);
    expect(getLoginRetryDelay(1)).toBe(2 * LOGIN_RETRY_BASE_MS);
    expect(getLoginRetryDelay(20)).toBe(LOGIN_RETRY_MAX_MS);
  });

  it('handles client error events instead of throwing them', () => {
    // Arrange
    const client = fakeClient(jest.fn(async () => 'ok'));
    new DiscordService(client);

    // Act + Assert
    expect(() => client.emit('error', new Error('socket hang up'))).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('logs in again when the session is invalidated', async () => {
    // Arrange
    jest.useFakeTimers();
    const login = jest.fn(async () => 'ok');
    const client = fakeClient(login);
    new DiscordService(client);

    // Act
    client.emit('invalidated');
    jest.advanceTimersByTime(0);

    // Assert
    expect(login).toHaveBeenCalledTimes(2);
  });
});

describe('DiscordService.sendDiscordMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips without throwing while the bot is not logged in', async () => {
    // Arrange
    const client = fakeClient(jest.fn().mockRejectedValue(new Error('TOKEN_INVALID')));
    const service = new DiscordService(client);

    // Act + Assert
    await expect(service.sendDiscordMessage('C1', payload)).resolves.toBeUndefined();
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not logged in'));
  });

  it('fetches a channel that is not in the cache', async () => {
    // Arrange
    const { client, service } = readyService();
    const send = jest.fn(async () => ({}));
    client.channels.fetch.mockResolvedValue({ send });

    // Act
    await service.sendDiscordMessage('C1', payload);

    // Assert
    expect(client.channels.fetch).toHaveBeenCalledWith('C1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('warns once for a channel the bot cannot reach and stops looking it up', async () => {
    // Arrange
    const { client, service } = readyService();
    client.channels.fetch.mockRejectedValue(Object.assign(new Error('Unknown Channel'), { code: 10003 }));

    // Act
    await service.sendDiscordMessage('C1', payload);
    await service.sendDiscordMessage('C1', payload);

    // Assert
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

describe('DiscordService.sendWelcomeMessage', () => {
  it('throws the Discord error so the install fails with it', async () => {
    // Arrange
    const { client, service } = readyService();
    client.channels.fetch.mockRejectedValue(Object.assign(new Error('Missing Access'), { code: 50001 }));

    // Act + Assert
    await expect(service.sendWelcomeMessage('C1')).rejects.toMatchObject({ code: 50001 });
  });
});
