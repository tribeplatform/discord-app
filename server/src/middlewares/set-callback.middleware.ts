import { verifyOAuthState } from '@/utils/auth';
import { NextFunction, Request, Response } from 'express';
import passport from 'passport';

/**
 * Rejects OAuth callbacks whose `state` was not issued by this app before the authorization code is exchanged,
 * then hands the request over to passport. The failure route receives the signed state so it can verify it as well.
 */
const setCallback = webhookPath => {
  return (req: Request, res: Response, next: NextFunction) => {
    const state = req.query.state;
    if (!verifyOAuthState(state)) {
      res.status(403).json({ success: false, message: 'Invalid or expired state.' });
      return;
    }
    passport.authorize('discord', { failureRedirect: `${webhookPath}/auth/callback/failure?state=${encodeURIComponent(state as string)}` })(
      req,
      res,
      next,
    );
  };
};

export default setCallback;
