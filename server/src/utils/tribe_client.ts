import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL } from '@/config';
import { GlobalClient, SpaceFields, TribeClient, Types } from '@tribeplatform/gql-client';
import jwt from 'jsonwebtoken';

// Bettermode rate-limits API calls ("You have made too many requests and exceeded the API quota").
// Every webhook used to fetch a new app token, the network and the space before doing any work, so these are cached per network.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_CLIENT_TTL_MS = 10 * 60 * 1000;
export const NETWORK_TTL_MS = 5 * 60 * 1000;
export const SPACE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { value: Promise<T>; expiresAt: number };

const clientCache = new Map<string, CacheEntry<TribeClient>>();
const networkCache = new Map<string, CacheEntry<Types.Network>>();
const spaceCache = new Map<string, CacheEntry<Types.Space>>();

export const clearTribeClientCache = () => {
  clientCache.clear();
  networkCache.clear();
  spaceCache.clear();
};

const clientExpiresAt = (client: TribeClient): number => {
  // The app token lives on the client's internal GraphqlClient.
  const token = (client as any)?.client?.accessToken;
  const decoded = typeof token === 'string' ? (jwt.decode(token) as jwt.JwtPayload | null) : null;
  if (decoded?.exp) return Math.min(decoded.exp * 1000 - TOKEN_EXPIRY_MARGIN_MS, Date.now() + DEFAULT_CLIENT_TTL_MS);
  return Date.now() + DEFAULT_CLIENT_TTL_MS;
};

const cached = <T>(cache: Map<string, CacheEntry<T>>, key: string, load: () => Promise<T>, expiresAt: (value: T) => number): Promise<T> => {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  const value = load();
  // Concurrent webhooks for the same network share one in-flight request.
  const newEntry: CacheEntry<T> = { value, expiresAt: Number.MAX_SAFE_INTEGER };
  cache.set(key, newEntry);
  value.then(
    result => {
      // An empty result (e.g. a space that doesn't exist) is not cached either.
      if (result) newEntry.expiresAt = expiresAt(result);
      else if (cache.get(key) === newEntry) cache.delete(key);
    },
    () => {
      // Never cache failures (e.g. a 429), the next webhook tries again.
      if (cache.get(key) === newEntry) cache.delete(key);
    },
  );
  return value;
};

export const getTribeClient = async ({ networkId }: { networkId: string }): Promise<TribeClient> =>
  cached(
    clientCache,
    networkId,
    () =>
      new GlobalClient({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        graphqlUrl: GRAPHQL_URL,
      }).getTribeClient({ networkId }),
    clientExpiresAt,
  );

/**
 * The network (name, domain, favicon) used to render Discord messages. It rarely changes, so it is cached for a few minutes.
 */
export const getNetwork = async (networkId: string, client: TribeClient): Promise<Types.Network> =>
  cached(
    networkCache,
    networkId,
    // Only request what the Discord embeds use; broad presets break when the API drops fields
    () => client.network.get({ favicon: 'basic' }),
    () => Date.now() + NETWORK_TTL_MS,
  );

/**
 * A space (name, url, banner) used to render Discord messages, cached for a few minutes.
 */
export const getSpace = async (networkId: string, spaceId: string, fields: SpaceFields, client: TribeClient): Promise<Types.Space> =>
  cached(
    spaceCache,
    `${networkId}:${spaceId}`,
    () => client.spaces.get({ id: spaceId }, fields),
    () => Date.now() + SPACE_TTL_MS,
  );

export const listMemberByIds = async ({ ids }: { ids: string[] }, client: TribeClient): Promise<Types.Member[]> => {
  const members: Types.Member[] = [];
  for (const idx in ids) {
    const member = await client.members.get({ id: ids[idx] }, 'basic');
    if (member) members.push(member);
  }
  return members;
};
