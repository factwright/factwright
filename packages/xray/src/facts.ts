/**
 * What the fact bank says about terms, read the way the skills write it (facts/README.md): the
 * skills in skills.md, the degrees and certifications in profile.md, each claim's Keywords line,
 * and what gaps.md says the user doesn't have. A term the bank backs can go on a resume. One it
 * doesn't is a real gap.
 */

/** A file of the fact bank: its path in the workspace, such as "facts/skills.md", and its text. */
export interface FactFile {
  path: string;
  text: string;
}

/** A claim's Keywords line: the posting terms the claim honestly proves. */
export interface Keywords {
  text: string;
  /** Where it is, such as "acme-health.md · Cut wait times". */
  where: string;
  /** Whether the claim still waits for the user to confirm it. */
  unconfirmed: boolean;
}

export interface FactTerms {
  /** Each skill in skills.md: a table row's first cell, or a list item. */
  skills: string[];
  /** The degrees, certifications, licenses and languages in profile.md, line by line. */
  credentials: string[];
  keywords: Keywords[];
  /** What the user said they don't have: gaps.md's Doesn't have list. */
  saidNo: string[];
}

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** A table row's cells, or null for a line that isn't one, or is a table's rule. */
function cells(line: string): string[] | null {
  if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+\|?\s*$/.test(line)) return null;
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** A list item's words, or null. */
const item = (line: string) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null;

/** The skills in skills.md: each row's first cell, past the header row, and each list item. */
function skillsIn(text: string): string[] {
  const skills: string[] = [];
  let header = true;
  for (const line of text.split(/\r?\n/)) {
    const row = cells(line);
    if (row) {
      // A table's first row names its columns.
      if (!header && row[0]) skills.push(row[0].replace(/\*\*/g, ''));
      header = false;
      continue;
    }
    if (!/^\s*\|/.test(line)) header = true;
    const listed = item(line);
    if (listed) skills.push(listed.replace(/\*\*/g, ''));
  }
  return skills;
}

/** Each claim's Keywords line, with its claim and whether it's confirmed. */
function keywordsIn(file: FactFile): Keywords[] {
  const found: Keywords[] = [];
  let claim = '';
  let unconfirmed = false;
  for (const line of file.text.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      claim = heading[1]?.trim() ?? '';
      unconfirmed = false;
      continue;
    }
    if (/^`[a-z-]+`/.test(line.trim())) unconfirmed = /`unconfirmed`/.test(line);
    const keywords = line.match(/^\s*[-*+]\s+\*\*Keywords:?\*\*:?\s*(.+)$/i)?.[1];
    if (keywords) {
      found.push({
        text: keywords.trim(),
        where: claim ? `${fileName(file.path)} · ${claim}` : fileName(file.path),
        unconfirmed,
      });
    }
  }
  return found;
}

/** What gaps.md's Doesn't have part lists: each row's topic, or each list item. */
function saidNoIn(text: string): string[] {
  const topics: string[] = [];
  let inside = false;
  let header = true;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      inside = /doesn['’]?t have|does not have|don['’]?t have/i.test(heading[1] ?? '');
      header = true;
      continue;
    }
    if (!inside) continue;
    const row = cells(line);
    if (row) {
      if (!header && row[0]) topics.push(row[0]);
      header = false;
      continue;
    }
    const listed = item(line);
    if (listed) topics.push(listed);
  }
  return topics;
}

/** The lines under profile.md's headings for degrees, certifications, licenses and languages. */
function credentialsIn(text: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      inside = /educat|degree|certif|licen[cs]|language|training/i.test(heading[1] ?? '');
      continue;
    }
    if (inside && line.trim()) lines.push(line.trim());
  }
  return lines;
}

/** What the fact bank's files say about terms. */
export function readFacts(files: readonly FactFile[]): FactTerms {
  const terms: FactTerms = { skills: [], credentials: [], keywords: [], saidNo: [] };
  for (const file of files) {
    const name = fileName(file.path).toLowerCase();
    if (name === 'readme.md') continue;
    if (name === 'gaps.md') {
      terms.saidNo.push(...saidNoIn(file.text));
      continue;
    }
    if (name === 'skills.md') terms.skills.push(...skillsIn(file.text));
    if (name === 'profile.md') terms.credentials.push(...credentialsIn(file.text));
    terms.keywords.push(...keywordsIn(file));
  }
  return terms;
}
