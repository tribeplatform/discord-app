import { NextFunction, Request, Response } from 'express';
import { logger } from '@utils/logger';
import { isSafeRedirect, verifyOAuthState } from '@utils/auth';

// Discord error codes with a message the community admin can act on.
const DISCORD_ERROR_MESSAGES: Record<number, string> = {
  50001: 'You have to select a public channel to make a connection',
};

const readOAuthError = (oauthError: any): { code: number; message: string } => {
  const result = { code: -1, message: 'Unknown Error' };
  try {
    const data = typeof oauthError?.data === 'string' ? JSON.parse(oauthError.data) : oauthError?.data;
    if (data?.code) result.code = parseInt(data.code, 10) || -1;
    if (data?.message) result.message = data.message;
  } catch (err) {
    // Not JSON: keep the generic message.
  }
  return result;
};

/**
 * OAuth flow errors are sent back to the community (only to a redirect carried in a state this app signed).
 * Everything else, including webhook signature failures, gets its own status code as JSON.
 * Before, every error was parsed as an OAuth error with a base64 state; for a webhook request that threw,
 * so a 403 for a bad signature reached the client as a 500.
 */
const errorMiddleware = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);

  let status: number = error?.status || error?.statusCode || 500;
  let { code, message } = { code: parseInt(error?.code, 10) || 0, message: error?.message || 'Something went wrong' };
  if (error?.oauthError) {
    ({ code, message } = readOAuthError(error.oauthError));
    status = 400;
  }
  if (DISCORD_ERROR_MESSAGES[code]) {
    // A Discord API error (e.g. thrown by the welcome message during the install) the admin can fix.
    message = DISCORD_ERROR_MESSAGES[code];
    status = 400;
  }

  const log = `[${req.method}] ${req.path} >> Code:: ${code} StatusCode:: ${status}, Message:: ${message}`;
  if (status >= 500) {
    logger.error(log);
    logger.error(error);
  } else logger.warn(log);

  // Don't hand internal error details to the client.
  if (status >= 500) message = 'Something went wrong';

  const redirect = req.query?.state ? verifyOAuthState(req.query.state)?.redirect : undefined;
  if (isSafeRedirect(redirect)) {
    const separator = redirect.includes('?') ? '&' : '?';
    return res.redirect(`${redirect}${separator}error=true&message=${encodeURIComponent(message)}&code=${code}`);
  }
  return res.status(status).json({ success: false, message });
};

export default errorMiddleware;
