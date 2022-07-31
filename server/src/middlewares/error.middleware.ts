import e, { NextFunction, Request, Response } from 'express';
import { logger } from '@utils/logger';
import { APP_SETTING_URL } from '@/config';

const errorMiddleware = (error: any, req: Request, res: Response, next: NextFunction) => {
  try {
    let message: string = "";
    let code:number = -1

    if(error.oauthError){ //Internal OAuth Error
      const err = JSON.parse(error.oauthError.data);
      code = err.code;
      message = err.message;
  }
    else{
      const status: number = error.status || 500;
      message = error.message || 'Something went wrong';
      code = error.code || 0
      logger.error(`[${req.method}] ${req.path} >> Code:: ${code} StatusCode:: ${status}, Message:: ${message}`);
    }
    res.redirect(`${APP_SETTING_URL}?error=true&message=${encodeURIComponent(message)}&code=${code}`)


  } catch (error) {
    next(error);
  }
};

export default errorMiddleware;
