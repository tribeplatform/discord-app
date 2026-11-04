import * as crypto from 'crypto';

const MILLISECONDS_IN_MINUTE = 1000 * 60;

export const getSignature = (options: { secret: string; body: string; timestamp: number }): string => {
  const { secret, body, timestamp } = options;
  return crypto.createHmac('sha256', secret).update(`${timestamp}:${body}`).digest('hex');
};

export const verifySignature = (options: { signature: string; secret: string; body: string; timestamp: number }): boolean => {
  const { signature, secret, body, timestamp } = options;
  if (typeof signature !== 'string' || !signature.length || !Number.isFinite(timestamp)) return false;
  const timeDifference = (new Date().getTime() - timestamp) / MILLISECONDS_IN_MINUTE;
  if (timeDifference > 5) return false;
  const hash = getSignature({ secret, body, timestamp });
  // timingSafeEqual throws on a length mismatch.
  if (signature.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
};

