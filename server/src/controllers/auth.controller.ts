import { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import { isSafeRedirect, signOAuthState, verifyConnectToken, verifyOAuthState } from '@utils/auth';

class AuthController {
  public webhookAuth = async (req: Request, res: Response, next: NextFunction) => {
    const { jwt } = req.query;
    if (!jwt) {
      res.status(400).json({ success: false, message: '"jwt" is a mandatory param.' });
      return;
    }
    try {
      const context = verifyConnectToken(jwt);
      if (!context) {
        res.status(403).json({ success: false, message: `You don't have access to this page.` });
        return;
      }
      // Everything carried through the OAuth flow comes from the signed connect token, never from the query string.
      const state = signOAuthState(context);

      passport.authorize('discord', {
        state,
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  public webhookAuthCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const redirect = verifyOAuthState(req.query.state)?.redirect;

      if (isSafeRedirect(redirect)) {
        return res.redirect(redirect);
      }

      res.status(200).json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  };
  public webhookAuthFailure = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const message = 'The request has been canceled by the requestor';
      const code = -1;
      const redirect = verifyOAuthState(req.query.state)?.redirect;
      if (!isSafeRedirect(redirect)) {
        res.status(200).json({ success: false, message, code });
        return;
      }
      const separator = redirect.includes('?') ? '&' : '?';
      res.redirect(`${redirect}${separator}error=true&message=${encodeURIComponent(message)}&code=${code}`);
    } catch (error) {
      next(error);
    }
  };
}

export default AuthController;
