/** The characters that make a confidential term a pattern, which a plain name needs escaped. */
const SPECIAL = /[.()[\]+?*|\\^${}]/g;

/** A name as a line of guide/confidential-terms.txt, matched as it reads. */
export const escapeTerm = (name: string) => name.trim().replace(SPECIAL, (char) => `\\${char}`);

/** A line of the file as the user would type it, with its escapes taken out. */
export const plainTerm = (line: string) => line.replace(/\\(.)/g, '$1');

/** The top of the file when the app starts it. */
export const TERMS_HEADER =
  '# Names that must never appear in anything sent to an employer: customers, colleagues, codenames, internal tools and hosts. One per line, matched ignoring case.';

/**
 * The file with the user's list of names: lines they kept stay exactly as they were, new names
 * are escaped, and removed ones go. Comments stay where they are.
 */
export function withTerms(file: string | null, names: readonly string[]): string {
  const lines = (file ?? `${TERMS_HEADER}\n`).split(/\r?\n/);
  const wanted = names.map((name) => name.trim()).filter(Boolean);
  const kept: string[] = [];
  const have = new Set<string>();
  for (const line of lines) {
    const term = line.trim();
    if (!term || term.startsWith('#')) {
      kept.push(line);
      continue;
    }
    const plain = plainTerm(term).toLowerCase();
    if (wanted.some((name) => name.toLowerCase() === plain) && !have.has(plain)) {
      kept.push(line);
      have.add(plain);
    }
  }
  while (kept.length > 0 && kept.at(-1) === '') kept.pop();
  for (const name of wanted) {
    if (!have.has(name.toLowerCase())) {
      kept.push(escapeTerm(name));
      have.add(name.toLowerCase());
    }
  }
  return `${kept.join('\n')}\n`;
}

/** The names in the file, as the user would type them. */
export function termsIn(file: string | null): string[] {
  return (file ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(plainTerm);
}
