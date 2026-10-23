import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SERVER_URL } from '@config';

import passport from 'passport';
import express from 'express';
import { createLogger } from '@/utils/logger';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { VerifyCallback } from 'passport-oauth2';
import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import DiscordRepository from '@/repositories/discord.repository';
import discordService from '@/services/discord.service';
import { verifyOAuthState } from '@/utils/auth';
const logger = createLogger('PassportMiddleware')
const init = (app: express.Application) => {


  passport.use(
    new DiscordStrategy(
      {
        clientID: DISCORD_CLIENT_ID,
        clientSecret: DISCORD_CLIENT_SECRET,
        scope: ['identify', 'email', 'bot', 'guilds', 'webhook.incoming'],
        callbackURL: `${SERVER_URL}/api/discord/webhook/auth/callback`,
        passReqToCallback: true,
      },
      async (req: express.Request, accessToken: string, refreshToken: string, params: any, profile: any, done: VerifyCallback) => {
        try {

          const incomingProfile: IncomingProfile = profile;

          const state = verifyOAuthState(req.query.state);
          if (!state) {
            return done(new Error('Invalid or expired OAuth state'), false);
          }
          const { networkId, memberId, spaceIds } = state;

          const channelId = params?.webhook?.channel_id;
          if (!channelId || !params?.webhook?.id) {
            // Discord finished the flow without creating a channel webhook; send the user to the failure page instead of a 500.
            logger.warn(`Discord OAuth returned no channel webhook networkId=${networkId}`);
            return done(null, false);
          }

          let channelName: string;
          try {
            channelName = (await discordService.getChannelInfo(channelId))?.name;
          } catch (err) {
            // Only used as a label in the settings; the bot may not see the channel yet.
            logger.warn(`Unable to load the Discord channel name channelId=${channelId} message=${err?.message}`);
          }

          incomingProfile.refreshToken = refreshToken;
          incomingProfile.networkId = networkId;
          incomingProfile.memberId = memberId;
          incomingProfile.spaceIds = spaceIds?.split(',') || [];
          incomingProfile.webhookId = params?.webhook?.id;
          incomingProfile.channelId = channelId;
          incomingProfile.token = params?.webhook?.token;
          incomingProfile.channelName = channelName;

          // Also checks that the bot can post there: a Discord error (e.g. 50001 Missing Access for a private channel)
          // fails the install and is shown to the admin by the error middleware.
          await discordService.sendWelcomeMessage(incomingProfile.channelId);

          logger.log(`Registering a new Discord connection networkId=${networkId} channelId=${incomingProfile.channelId} webhookId=${incomingProfile.webhookId}`);

          const data = await DiscordRepository.insertProfileData(incomingProfile);
          if (!data) return done(new Error('Unable to save the Discord connection'));

          done(null, data);

        } catch (err) {
          logger.error('An error occured during the DiscordStrategy handling');
          logger.error(err);
          done(err);
        }
      },
    ),
  );

  app.use(passport.initialize());
};

export default {
  init,
};
