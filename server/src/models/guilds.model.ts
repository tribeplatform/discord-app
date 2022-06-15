import { Schema } from 'mongoose';

const guildSchema: Schema = new Schema({
  id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
  },
  owner: {
    type: Boolean,
    required: true,
  },
  permissions: {
    type: Number,
    required: true,
  },
  permissions_new: {
    type: String,
    required: true,
  },
  features: [
    {
      type: String,
    },
  ],
});

export default guildSchema;
