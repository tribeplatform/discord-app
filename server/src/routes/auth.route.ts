import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import AuthController from '@controllers/auth.controller';
import passport from 'passport';

class AuthRoute implements Routes {
  public path = '/api/discord';
  public router = Router();
  public authController = new AuthController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const webhookPath = `${this.path}/webhook`
    
    this.router.get(`${webhookPath}/auth`, this.authController.webhookAuth);
    this.router.get(`${webhookPath}/auth/callback`, passport.authorize('discord', { failureRedirect: `${this.path}/auth/callback/failure` }), this.authController.webhookAuthCallback);
    this.router.get(`${webhookPath}/auth/callback/failure`, this.authController.webhookAuthFailure);

    // this.router.get(`${webhookPath}/auth/callback`, passport.authenticate("discord"),(req,res)=>{
    //   console.log(req.query)
    //   console.log(req.body)
    //   res.send({msg:"sala"});
    // });

    //this.router.get(`${webhookPath}/auth/callback/failure`, this.authController.webhookAuthFailure);
    //this.router.get(`${webhookPath}/auth/xcallback`, passport.authorize('webhook', { failureRedirect: `${this.path}/auth/callback/failure` }), this.authController.webhookAuthCallback);
  }
}

export default AuthRoute;
