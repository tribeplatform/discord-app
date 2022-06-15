import mongoose from "mongoose";
import { DiscordGuild } from "./discord-guild.interface";

export interface IncomingProfile {
  _id: mongoose.Types.ObjectId | string
  id: string
  username: string,
  avatar: string;
  public_flags: number,
  flags: number,
  email: string,
  verified: boolean,
  accessToken: string,
  refreshToken: string,
  networkId: string,
  memberId: string,
  spaceIds: string[],
  guilds: DiscordGuild[],
  channelId: string,
  channelName: string,
  token: string,
  webhookId: string,
  fetchedAt: Date
}
