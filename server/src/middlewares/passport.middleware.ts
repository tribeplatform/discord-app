import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, } from '@config';

import passport from 'passport';
import express from 'express';
import { logger } from '@/utils/logger';
import { Types } from '@tribeplatform/gql-client';
import { Profile, Strategy as DiscordStrategy } from 'passport-discord'
import { VerifyCallback } from 'passport-oauth2';
import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import DiscordRepository from '@/repositories/discord.repository'
import discordService from '@/services/discord.service';


const DEFAULT_EVENTS = [
  'post.published',
];

const init = (app: express.Application) => {

  
  passport.use(
    new DiscordStrategy(
      {
        clientID: DISCORD_CLIENT_ID, 
        clientSecret: DISCORD_CLIENT_SECRET,
        scope: ['identify', 'bot', 'guilds', 'webhook.incoming'],
        callbackURL: '/api/discord/webhook/auth/callback',
        passReqToCallback:true,
      },
      async (req: express.Request, accessToken: string, refreshToken: string,params: string, profile: any, done: VerifyCallback) => {
        try {

          const incomingProfile: IncomingProfile = profile;

        
          let buff = Buffer.from(String(req.query.state), 'base64');
          const { n: networkId, m: memberId, s: spaceIds } = JSON.parse(buff.toString('ascii')) as { n: string; m: string; s: string };

          incomingProfile.refreshToken = refreshToken;
          incomingProfile.networkId = networkId;
          incomingProfile.memberId = memberId;
          incomingProfile.spaceIds = spaceIds?.split(',') || [];
          incomingProfile.webhookId = params?.webhook?.id;
          incomingProfile.channelId = params?.webhook?.channel_id;
          incomingProfile.token = params?.webhook?.token;
          incomingProfile.channelName = params?.webhook?.name;

          const data = await DiscordRepository.insertProfileData(incomingProfile)

          discordService.sendWelcomeMessage(incomingProfile.channelId)

          done(null, data);
        } catch (err) {
          logger.error('An error occured during the SlackStrategy handling');
          logger.error(err);
          done(err, {});
        }
      },
    ),
  );

  passport.serializeUser(function(user, done) {
    console.log("serial");
    console.log(user);
    done(null, user);
  });
  
  passport.deserializeUser(function(user, done) {
    console.log("des");
    console.log(user);
    done(null, user);
  });
  
  app.use(passport.initialize());
};

export default {
  init,
};
