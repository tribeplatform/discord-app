import { Types } from '@tribeplatform/gql-client';

export type Payload = {
  event: string,
  network: Types.Network,
  context: boolean,
  member?: Types.Member,
  actor?: Types.Member
  space?: Types.Space,
  post?: Types.Post
}
