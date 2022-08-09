import { verify } from '@/utils/auth';
import { NextFunction, Request, Response } from 'express';
import passport from 'passport';

const setCallback = (webhookPath) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const decodedData = JSON.parse(Buffer.from(req.query.state as string, 'base64').toString('binary'));
    passport.authorize('discord', { failureRedirect: `${webhookPath}/auth/callback/failure?community_url=${decodedData.r}` })(req,res,next)
  };
}

export default setCallback;
