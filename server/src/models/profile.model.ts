import { model, Schema, Document } from 'mongoose';
import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import guildSchema from './guilds.model';


const IncomingProfileSchema: Schema = new Schema({
  id: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  webhookId: {
    type: String,
    required: true,
  },
  channelId: {
    type: String,
    required: true,
  },
  channelName: {
    type: String,
    required: false,
  },
  token: {
    type: String,
    required: true,
  },
  avatar: {
    type: String,
  },
  public_flags: {
    type: Number,
  },
  flags: {
    type: Number,
  },
  email: {
    type: String,
    required: false,
  },
  verified: {
    type: String,
  },
  refreshToken: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  fetchedAt: {
    type: Date,
  },
  guilds: {
    type: [guildSchema],
    required: false,
  },
  networkId: {
    type: String,
    required: true,
  },
  memberId: {
    type: String,
    required: true,
  },
  spaceIds: [
    {
      type: String,
    },
  ],
});

IncomingProfileSchema.index({ networkId: 1 });

const incomingProfileModel = model<IncomingProfile & Document>('IncomingProfile', IncomingProfileSchema);

export default incomingProfileModel;
