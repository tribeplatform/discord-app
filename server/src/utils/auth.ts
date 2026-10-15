import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { CLIENT_SECRET } from '@/config';

const ISSUER = 'tribe-discord-app';
const ALGORITHM = 'HS256';

const CONNECT_TOKEN_AUDIENCE = 'tribe-discord-app:connect';
const OAUTH_STATE_AUDIENCE = 'tribe-discord-app:oauth-state';

export const CONNECT_TOKEN_TTL_SECONDS = 10 * 60;
export const OAUTH_STATE_TTL_SECONDS = 15 * 60;

const MAX_FIELD_LENGTH = 2048;

export interface ConnectContext {
  networkId: string;
  memberId?: string;
  spaceIds?: string;
  redirect?: string;
}

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.length || value.length > MAX_FIELD_LENGTH) return undefined;
  return value;
};

const signContext = (context: ConnectContext, audience: string, expiresIn: number): string =>
  jwt.sign(
    {
      m: optionalString(context.memberId),
      s: optionalString(context.spaceIds),
      r: optionalString(context.redirect),
    },
    CLIENT_SECRET,
    {
      algorithm: ALGORITHM,
      subject: context.networkId,
      issuer: ISSUER,
      audience,
      expiresIn,
      jwtid: crypto.randomBytes(16).toString('hex'),
    },
  );

const verifyContext = (token: unknown, audience: string): ConnectContext | null => {
  if (typeof token !== 'string' || !token.length) return null;
  try {
    const payload = jwt.verify(token, CLIENT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience,
    }) as jwt.JwtPayload;
    if (!payload || typeof payload.sub !== 'string' || !payload.sub.length) return null;
    return {
      networkId: payload.sub,
      memberId: optionalString(payload.m),
      spaceIds: optionalString(payload.s),
      redirect: optionalString(payload.r),
    };
  } catch (err) {
    return null;
  }
};

/**
 * Short-lived token that allows starting the Discord OAuth flow for a network.
 * It is only handed out to network admins through the UPDATE_SETTINGS webhook.
 */
export const signConnectToken = (context: ConnectContext): string => signContext(context, CONNECT_TOKEN_AUDIENCE, CONNECT_TOKEN_TTL_SECONDS);
export const verifyConnectToken = (token: unknown): ConnectContext | null => verifyContext(token, CONNECT_TOKEN_AUDIENCE);

/**
 * Signed OAuth `state` parameter, verified on the OAuth callback before any of its data is used.
 */
export const signOAuthState = (context: ConnectContext): string => signContext(context, OAUTH_STATE_AUDIENCE, OAUTH_STATE_TTL_SECONDS);
export const verifyOAuthState = (state: unknown): ConnectContext | null => verifyContext(state, OAUTH_STATE_AUDIENCE);

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

const toHostname = (domain: unknown): string | null => {
  if (typeof domain !== 'string' || !domain.trim().length) return null;
  try {
    return new URL(`https://${domain.trim().replace(/^https?:\/\//i, '')}`).hostname.toLowerCase();
  } catch (err) {
    return null;
  }
};

/**
 * Hostnames a network can be reached on (primary domain first, then the domain being migrated to, subfolder domain and aliases).
 */
export const getNetworkHostnames = (
  network:
    | { domain?: string | null; newDomain?: string | null; domainSubfolder?: string | null; aliases?: (string | null)[] | null }
    | null
    | undefined,
): string[] => {
  if (!network) return [];
  const domains = [network.domain, network.newDomain, network.domainSubfolder, ...(Array.isArray(network.aliases) ? network.aliases : [])];
  const hostnames = domains.map(toHostname).filter(Boolean) as string[];
  return Array.from(new Set(hostnames));
};

/**
 * A redirect target is accepted only if it is an absolute https URL (http is allowed for localhost only)
 * and, when a list of allowed hostnames is given, its hostname is one of them.
 */
export const isSafeRedirect = (redirect: unknown, allowedHostnames?: string[]): boolean => {
  if (typeof redirect !== 'string' || !redirect.length || redirect.length > MAX_FIELD_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(redirect);
  } catch (err) {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTNAMES.includes(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return false;
  if (url.username || url.password) return false;
  if (allowedHostnames && allowedHostnames.length && !allowedHostnames.includes(hostname)) return false;
  return true;
};

/**
 * Returns the redirect if it is safe for the given hostnames, otherwise falls back to the network's primary domain.
 */
export const resolveRedirect = (redirect: unknown, allowedHostnames: string[]): string | undefined => {
  if (isSafeRedirect(redirect, allowedHostnames)) return redirect as string;
  if (allowedHostnames.length) return `https://${allowedHostnames[0]}/`;
  return undefined;
};

export default {
  signConnectToken,
  verifyConnectToken,
  signOAuthState,
  verifyOAuthState,
  isSafeRedirect,
  resolveRedirect,
  getNetworkHostnames,
};
