import { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import auth from '@utils/auth';
class AuthController {
  public webhookAuth = async (req: Request, res: Response, next: NextFunction) => {
    const { jwt, member, spaceIds, redirect = '/' } = req.query;
    if (!jwt) {
      res.status(400).json({ success: false, message: '"jwt" is a mandatory param.' });
      return;
    }
    try {
      const decodedJwt = auth.verify(jwt as string) as any;
      if (!decodedJwt || !decodedJwt.sub) {
        res.status(403).json({ success: false, message: `You don't have access to this page.` });
        return;
      }
      const state = Buffer.from(JSON.stringify({ n: decodedJwt.sub, m: member, s: spaceIds, r: redirect }), 'ascii').toString('base64');

      
      passport.authorize('discord', {
        permissions:2048,
        state,
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  public async discordOauth2(scopes, permissions){
    
  }

  public webhookAuthCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let buff = Buffer.from(String(req.query.state), 'base64');
      const { r: redirect } = JSON.parse(buff.toString('ascii')) as { r: string };

      if (!!redirect) {
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
      let buff = Buffer.from(String(req.query.state), 'base64');
      const { r: redirect } = JSON.parse(buff.toString('ascii')) as { r: string };
      if (!!redirect) {
        return res.redirect(redirect);
      }
      res.status(200).json({
        success: false,
      });
    } catch (error) {
      next(error);
    }
  };
}

export default AuthController;
