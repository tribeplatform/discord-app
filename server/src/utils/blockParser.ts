import { Types } from '@tribeplatform/gql-client';

import { NodeHtmlMarkdown } from 'node-html-markdown';

export const createHyperlink = ({
                                  text,
                                  url,
                                }: { text: string; url: string }): string => `[${(text)}](${url})`;
export const createEntityHyperLink = (entity: Types.Member | Types.Space) => createHyperlink({
  text: entity.name,
  url: entity.url,
});

export const createQuote = (text: string) => `> ${text}`;

export const parseHtml = (text: string) => NodeHtmlMarkdown.translate(text);

export const getEntityName = (entity: Types.Member | Types.Space): string => entity?.name || '';

export const escapeText = (text: string): string => text.replace('>', '').replace('<', '').replace('&', '');

export function truncate(str, n) {
  return (str.length > n) ? str.substr(0, n - 1) + '...' : str;
}
