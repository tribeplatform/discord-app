import { Types } from '@tribeplatform/gql-client';

import { NodeHtmlMarkdown } from 'node-html-markdown';

export const createHyperlink = ({
                                  text,
                                  url,
                                }: { text: string; url: string }): string => `[${(text)}](${url})`;
// Events can arrive without a member, actor or space (for example automatic space joins
// have no actor). Fall back to plain text instead of throwing, so the message still sends.
export const createEntityHyperLink = (entity?: Types.Member | Types.Space) => {
  if (!entity?.name) return '';
  if (!entity.url) return entity.name;
  return createHyperlink({
    text: entity.name,
    url: entity.url,
  });
};

export const createQuote = (text: string) => `> ${text}`;

export const parseHtml = (text: string) => NodeHtmlMarkdown.translate(text);

export const getEntityName = (entity: Types.Member | Types.Space): string => entity?.name || '';

export const escapeText = (text: string): string => text.replace('>', '').replace('<', '').replace('&', '');

export function truncate(str, n) {
  return (str.length > n) ? str.substr(0, n - 1) + '...' : str;
}
