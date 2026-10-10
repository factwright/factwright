const COMBINING_MARKS = /[̀-ͯ]/g;
const PARENTHETICAL = /\(.*?\)/g;
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

/** One key per company, however it's written: "Acme, Inc." and "The Acme Company (US)" are both "acme". */
export function companyKey(name: string): string {
  return slug(name.toLowerCase().replace(PARENTHETICAL, ' ').replace(COMPANY_NOISE, ' '));
}

/** One key per role title, ignoring parentheticals: "Senior Engineer (Remote)" is "senior-engineer". */
export function roleKey(title: string): string {
  return slug(title.replace(PARENTHETICAL, ' '));
}
