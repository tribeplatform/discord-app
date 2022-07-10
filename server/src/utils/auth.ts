import { CLIENT_SECRET, GRAPHQL_URL } from '@/config';
import jwt from 'jsonwebtoken';

export const sign = (options: { networkId: string }) => {
  return jwt.sign(
    {
      sub: options.networkId,
      aud: GRAPHQL_URL,
      iss: 'tribe-discord-app',
    },
    CLIENT_SECRET,
    {
      expiresIn: '2d',
    },
  );
};
export const verify = (token: string) => {
  return jwt.verify(token, CLIENT_SECRET, {
    ignoreExpiration: false,
  });
};

export default{
    sign,
    verify
}
