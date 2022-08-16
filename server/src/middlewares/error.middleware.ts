import e, { NextFunction, Request, Response } from 'express';
import { logger } from '@utils/logger';

const errorMiddleware = (error: any, req: Request, res: Response, next: NextFunction) => {
  try {
    let message: string = "";
    let code:number = -1

    if(error.oauthError){ //Internal OAuth Error
      if(error.oauthError.data){
        const err = JSON.parse(error.oauthError.data);
        code = err.code;
        message = err.message;
      }
      code = -1;
      message = "Unknown Error";
  }
    else{
      const status: number = error.status || 500;
      message = error.message || 'Something went wrong';
      code = parseInt(error.code) || 0
      logger.error(`[${req.method}] ${req.path} >> Code:: ${code} StatusCode:: ${status}, Message:: ${message}`);
    }
    const decodedData = JSON.parse(Buffer.from(req.query.state as string, 'base64').toString('binary'));

    //customize errors
    switch (code) {
      case 50001:
        message = 'You have to select a public channel to make a connection'
        break
      default:
        break
    }

    res.redirect(`${decodedData.r}?error=true&message=${encodeURIComponent(message)}&code=${code}`)


  } catch (error) {
    next(error);
  }
};

export default errorMiddleware;
