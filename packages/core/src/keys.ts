const COMBINING_MARKS = /[̀-ͯ]/g;
const COMPANY_NOISE = /\b(inc|llc|ltd|corp|corporation|co|company|the)\b/g;

/** Lowercase, accent-free and hyphen-separated: "Café & Co." becomes "cafe-and-co". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Text with each "(…)" made a space: from a "(" to the first ")" after it on the same line, as
 * /\(.*?\)/g would take it. It's read in one pass, where that pattern reads to the end of the
 * line again for each "(" left open.
 */
function withoutParentheticals(text: string): string {
  return text.replace(/[^\n\r\u2028\u2029]+/g, (line) => {
    let kept = '';
    let at = 0;
    for (let open = line.indexOf('('); open >= 0; open = line.indexOf('(', at)) {
      const close = line.indexOf(')', open + 1);
      if (close < 0) break;
      kept += `${line.slice(at, open)} `;
      at = close + 1;
    }
    return kept + line.slice(at);
  });
}

/** One key per company, however it's written: "Acme, Inc." and "The Acme Company (US)" are both "acme". */
export function companyKey(name: string): string {
  return slug(withoutParentheticals(name.toLowerCase()).replace(COMPANY_NOISE, ' '));
}

/** One key per role title, ignoring parentheticals: "Senior Engineer (Remote)" is "senior-engineer". */
export function roleKey(title: string): string {
  return slug(withoutParentheticals(title));
}
