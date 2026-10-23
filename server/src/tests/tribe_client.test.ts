jest.mock('@/config', () => ({ CLIENT_ID: 'id', CLIENT_SECRET: 'secret', GRAPHQL_URL: 'https://api.bettermode.test/global' }));

const mockGetTribeClient = jest.fn();
jest.mock('@tribeplatform/gql-client', () => ({
  GlobalClient: jest.fn().mockImplementation(() => ({ getTribeClient: (...args: any[]) => mockGetTribeClient(...args) })),
}));

import jwt from 'jsonwebtoken';
import { clearTribeClientCache, getNetwork, getSpace, getTribeClient, NETWORK_TTL_MS, SPACE_TTL_MS } from '@/utils/tribe_client';

const tokenExpiringIn = (seconds: number) => jwt.sign({ exp: Math.floor(Date.now() / 1000) + seconds }, 'k');
// Shaped like TribeClient: the token lives on its internal GraphqlClient.
const clientWithToken = (token: string, extra: Record<string, any> = {}) => ({ client: { accessToken: token }, ...extra });

describe('tribe_client cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    clearTribeClientCache();
  });

  it('reuses the client for a network until its token is about to expire', async () => {
    // Arrange
    jest.useFakeTimers('modern');
    mockGetTribeClient.mockImplementation(async () => clientWithToken(tokenExpiringIn(8 * 60)));

    // Act
    const first = await getTribeClient({ networkId: 'net1' });
    const second = await getTribeClient({ networkId: 'net1' });
    jest.setSystemTime(Date.now() + 3 * 60 * 1000 + 1000);
    const third = await getTribeClient({ networkId: 'net1' });

    // Assert
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('keeps a client at most 10 minutes even with a long-lived token', async () => {
    // Arrange
    jest.useFakeTimers('modern');
    mockGetTribeClient.mockImplementation(async () => clientWithToken(tokenExpiringIn(24 * 60 * 60)));

    // Act
    await getTribeClient({ networkId: 'net1' });
    jest.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    await getTribeClient({ networkId: 'net1' });

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('keeps one client per network', async () => {
    // Arrange
    mockGetTribeClient.mockImplementation(async ({ networkId }) => clientWithToken(tokenExpiringIn(3600), { networkId }));

    // Act
    const a = await getTribeClient({ networkId: 'net1' });
    const b = await getTribeClient({ networkId: 'net2' });

    // Assert
    expect(a).not.toBe(b);
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight token request between concurrent webhooks', async () => {
    // Arrange
    mockGetTribeClient.mockImplementation(async () => clientWithToken(tokenExpiringIn(3600)));

    // Act
    const [a, b] = await Promise.all([getTribeClient({ networkId: 'net1' }), getTribeClient({ networkId: 'net1' })]);

    // Assert
    expect(a).toBe(b);
    expect(mockGetTribeClient).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed token request', async () => {
    // Arrange
    mockGetTribeClient.mockRejectedValueOnce(new Error('exceeded the API quota')).mockResolvedValueOnce(clientWithToken(tokenExpiringIn(3600)));

    // Act + Assert
    await expect(getTribeClient({ networkId: 'net1' })).rejects.toThrow('exceeded the API quota');
    await expect(getTribeClient({ networkId: 'net1' })).resolves.toBeDefined();
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('caches the network for a few minutes with the narrow field selection', async () => {
    // Arrange
    jest.useFakeTimers('modern');
    const client: any = { network: { get: jest.fn(async () => ({ id: 'net1', name: 'Community' })) } };

    // Act
    await getNetwork('net1', client);
    await getNetwork('net1', client);
    jest.setSystemTime(Date.now() + NETWORK_TTL_MS + 1);
    await getNetwork('net1', client);

    // Assert
    expect(client.network.get).toHaveBeenCalledTimes(2);
    expect(client.network.get).toHaveBeenCalledWith({ favicon: 'basic' });
  });

  it('caches spaces per network and space', async () => {
    // Arrange
    jest.useFakeTimers('modern');
    const client: any = { spaces: { get: jest.fn(async ({ id }) => ({ id, name: 'General' })) } };
    const fields: any = { banner: 'basic' };

    // Act
    await getSpace('net1', 's1', fields, client);
    await getSpace('net1', 's1', fields, client);
    await getSpace('net1', 's2', fields, client);
    await getSpace('net2', 's1', fields, client);
    jest.setSystemTime(Date.now() + SPACE_TTL_MS + 1);
    await getSpace('net1', 's1', fields, client);

    // Assert
    expect(client.spaces.get).toHaveBeenCalledTimes(4);
    expect(client.spaces.get).toHaveBeenCalledWith({ id: 's1' }, fields);
  });

  it('does not cache a failed or empty network lookup', async () => {
    // Arrange
    const client: any = {
      network: {
        get: jest
          .fn()
          .mockRejectedValueOnce(new Error('exceeded the API quota'))
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 'net1' }),
      },
    };

    // Act
    await expect(getNetwork('net1', client)).rejects.toThrow();
    await getNetwork('net1', client);
    await getNetwork('net1', client);
    await getNetwork('net1', client);

    // Assert
    expect(client.network.get).toHaveBeenCalledTimes(3);
  });
});
