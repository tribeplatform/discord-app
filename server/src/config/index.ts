import { config } from 'dotenv';

config({ path: `.env` });

export const CREDENTIALS = process.env.CREDENTIALS === 'true';
export const {
  NODE_ENV,
  PORT,
  DB_HOST,
  CLIENT_ID,
  CLIENT_SECRET,
  SIGNING_SECRET,
  NETWORK_ID,
  MEMBER_ID,
  GRAPHQL_URL,
  LOG_FORMAT,
  LOG_DIR = '../logs',
  ORIGIN,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  SERVER_URL,
  BOT_TOKEN,
  LOGGER_PRETTY_PRINT
} = process.env;
