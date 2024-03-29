import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import AuthController from '@controllers/auth.controller';
import passport from 'passport';
import setCallback from './../middlewares/set-callback.middleware'

class AuthRoute implements Routes {
  public path = '/api/discord';
  public router = Router();
  public authController = new AuthController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const webhookPath = `${this.path}/webhook`;

    this.router.get(`${webhookPath}/auth`, this.authController.webhookAuth);
    this.router.get(`${webhookPath}/auth/callback`, setCallback(webhookPath), this.authController.webhookAuthCallback);
    this.router.get(`${webhookPath}/auth/callback/failure`, this.authController.webhookAuthFailure);

  }
}

export default AuthRoute;
