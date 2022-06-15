import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, SERVER_URL } from '@/config';
import { GlobalClient, TribeClient, Types } from '@tribeplatform/gql-client';
import { chunk } from './util';
export const getTribeClient = async ({ networkId }: { networkId: string }): Promise<TribeClient> => {
  const globalClient = new GlobalClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    graphqlUrl: GRAPHQL_URL,
  });

  return await globalClient.getTribeClient({
    networkId,
  });
};

export const listMemberByIds = async ({ ids }: { ids: string[]}, client: TribeClient): Promise<Types.Member[]> => {
    const members: Types.Member[] = []
    for(let idx in ids){
        const member = await client.members.get({ id: ids[idx] }, 'basic')
        if(member) members.push(member)
    }
    return members
}