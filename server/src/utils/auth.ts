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
  return jwt.verify(token, '3cf0e21656324b4a89ebe9942d236a1e');
};

export default{
    sign,
    verify
}