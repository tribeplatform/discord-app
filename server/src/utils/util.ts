import * as cheerio from 'cheerio';

/**
 * @method isEmpty
 * @param {String | Number | Object} value
 * @returns {Boolean} true & false
 * @description this value is Empty Check
 */
export const isEmpty = (value: string | number | object): boolean => {
  if (value === null) {
    return true;
  } else if (typeof value !== 'number' && value === '') {
    return true;
  } else if (typeof value === 'undefined' || value === undefined) {
    return true;
  } else if (value !== null && typeof value === 'object' && !Object.keys(value).length) {
    return true;
  } else {
    return false;
  }
};

export const uniq = <T>(array: Array<T>): Array<T> => (array.length ? array.filter((value, index, self) => self.indexOf(value) === index) : array);

export const toMap = <T>(array: Array<T>, key: string): Map<string, T> => new Map<string, T>(array.map(item => [item[key], item]));

export const transformMentions = (html: string, baseUrl: string): string => {
  let $ = cheerio.load(html);
  $('a[data-type=mention]').each(function(i) {
    const dataId = $(this).attr('data-id');
    if (dataId) $(this).attr('href', baseUrl + dataId);
  });
  return $.html().toString();
};
