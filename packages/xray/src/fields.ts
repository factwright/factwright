import { type DateRange, dateRanges, singleDates } from './dates.ts';
import type { Line } from './read.ts';
import { headingKind, type Section, sectionsOf } from './sections.ts';

/** A job as a parser pulls it out: its title, company and dates, and where it found them. */
export interface Job {
  title: string | null;
  company: string | null;
  location: string | null;
  dates: DateRange;
  /** The line its dates are on. */
  line: number;
}

/** A degree or course of study. */
export interface School {
  degree: string | null;
  school: string | null;
  dates: string | null;
  line: number;
}

/** What a parser fills in from a resume, as an application form would show it. */
export interface Fields {
  name: string | null;
  /** The line the name is on, which should be the first. */
  nameLine: number | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
  jobs: Job[];
  education: School[];
  skills: string[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;

/** A phone number: 10 to 15 digits, with the spaces, dots, dashes and brackets numbers have. */
const PHONE =
  /(?<![\p{L}\p{N}/])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{6,16}\d(?![\p{L}\p{N}/])/u;

const LINK =
  /(?<![\p{L}\p{N}@.])(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|me|co|ai|app|edu|gov|us|uk|ca|de|info|page|site|xyz|design|tech)(?:\/[^\s,;·|)]*)?(?![\p{L}\p{N}@])/giu;

const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR|AB|BC|MB|NB|NL|NS|ON|PE|QC|SK';

const STATE_NAMES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|Ontario|Quebec|British Columbia|Alberta';

const COUNTRIES =
  'USA|US|U\\.S\\.|United States|UK|U\\.K\\.|United Kingdom|England|Scotland|Wales|Ireland|Canada|Mexico|Brazil|Argentina|Germany|France|Spain|Portugal|Italy|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Czechia|Romania|Greece|Turkey|Israel|UAE|India|Pakistan|Bangladesh|China|Japan|Korea|South Korea|Singapore|Malaysia|Philippines|Indonesia|Vietnam|Thailand|Australia|New Zealand|South Africa|Nigeria|Kenya|Egypt';

/** A place: "Denver, CO", "Austin, Texas", "London, UK", or remote work. */
const PLACE = new RegExp(
  `\\b(?:(?:[Rr]emote|REMOTE)(?:,? (?:${COUNTRIES}))?|[A-Z][\\p{L}.'-]+(?: [A-Z][\\p{L}.'-]+){0,3},\\s*(?:${STATES}|${STATE_NAMES}|${COUNTRIES}))(?![\\p{L}])`,
  'u',
);

/** Words in job titles, to tell a title from a company. */
const TITLE_WORDS =
  /\b(?:engineer|engineering|developer|manager|director|head|lead|leader|vp|vice president|president|chief|officer|founder|co-founder|owner|partner|principal|staff|senior|sr|junior|jr|analyst|scientist|designer|architect|consultant|specialist|coordinator|administrator|associate|assistant|intern|fellow|researcher|professor|lecturer|instructor|teacher|tutor|nurse|physician|therapist|counselor|technician|technologist|representative|agent|advisor|adviser|accountant|auditor|controller|attorney|paralegal|clerk|recruiter|generalist|strategist|planner|producer|editor|writer|marketer|marketing|sales|supervisor|operator|programmer|tester|owner|executive|ceo|cto|cfo|coo|cmo|cio|cpo|sre|devops|pharmacist|dietitian|aide|volunteer|apprentice|trainee|member|chair|mechanic|electrician|chef|cook|driver|buyer|broker|banker|trader|economist|statistician|investigator|officer)s?\b/i;

/**
 * A degree. Written plain, MA, MS and MD are states after a comma, as in "Boston, MA", so only
 * elsewhere are they degrees.
 */
const DEGREE =
  /(?<!,\s*)\b(?:MA|MS|MD)\b|\b(?:B\.?\s?[AS]\.?|B\.?Sc\.?|B\.?A\.?Sc\.?|B\.?Eng\.?|B\.?F\.?A\.?|BBA|BSN|M\.\s?[AS]\.?|M\.?Sc\.?|M\.?Eng\.?|MBA|MSN|MPH|MFA|M\.?Ed\.?|Ph\.?\s?D\.?|Ed\.?D\.?|M\.D\.?|J\.?D\.?|D\.?N\.?P\.?|A\.?A\.?S?\.?|A\.?S\.?N?\.?|Bachelor(?:'s|’s)?|Master(?:'s|’s)?|Doctor(?:ate)?|Associate(?:'s|’s)?|Diploma|Certificate|GED|High School)(?![\p{L}])/u;

const SCHOOL =
  /\b(?:University|College|Institute|School|Academy|Polytechnic|Conservatory|Seminary|Universidad|Université|Universität)\b/u;

/** A line's pieces, split where there's a wide gap: a title on the left and dates on the right. */
export function piecesOf(line: Line): string[] {
  if (line.runs.length === 0) {
    return line.text
      .split('\t')
      .map((piece) => piece.trim())
      .filter(Boolean);
  }
  const pieces: string[] = [];
  let piece = '';
  let end: number | null = null;
  for (const run of line.runs) {
    const wide = run.size * 1.5;
    const blank = !run.text.trim();
    if ((blank && run.width > wide) || (end !== null && run.x - end > wide)) {
      if (piece.trim()) pieces.push(piece.trim());
      piece = '';
    }
    if (!blank || run.width <= wide) piece += run.text;
    if (!blank) end = run.x + run.width;
  }
  if (piece.trim()) pieces.push(piece.trim());
  return pieces;
}

/**
 * The name at the start of a line, when there is one: the whole line, or its first piece when
 * marks set the name apart, as in "Jordan Avery | Senior Engineer".
 */
function nameIn(text: string): string | null {
  const first = text.split(/\s+[|·•—–]\s+|\s*\|\s*/)[0]?.trim() ?? '';
  if (looksLikeName(text)) return text.trim();
  return first !== text.trim() && looksLikeName(first) ? first : null;
}

/** A name: two to five words of letters, with no digits, at signs or other marks. */
function looksLikeName(text: string): boolean {
  if (/[\d@|·•:/]/.test(text) || headingKind(text)) return false;
  if (/^(?:resume|résumé|curriculum vitae|cv)$/i.test(text.trim())) return false;
  const words = text.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 5 &&
    words.every(
      (word) =>
        /^[\p{Lu}][\p{L}'’.-]*,?$/u.test(word) || /^(?:de|van|von|da|del|la|le)$/i.test(word),
    )
  );
}

/**
 * The longest line contact details are looked for in. A contact line is far shorter, and the
 * patterns that find an email or a link take longer the longer a line runs.
 */
const MAX_CONTACT_LINE = 300;

/** A phone number in a line, when one has 10 to 15 digits and isn't a span of years. */
function phoneIn(text: string): string | null {
  const match = text.match(PHONE)?.[0]?.trim();
  if (!match) return null;
  const digits = match.replace(/\D/g, '').length;
  if (digits < 10 || digits > 15) return null;
  // Years one after another, such as "2019 - 2021", aren't a phone number.
  if ((match.match(/\d+/g) ?? []).every((group) => /^(?:19|20)\d{2}$/.test(group))) return null;
  return match;
}

/** A line that could hold a job's title, company or place: short, and not a sentence. */
const headerLike = (line: Line | undefined) =>
  !!line &&
  line.text.split(/\s+/).length <= 10 &&
  !/[.;]$/.test(line.text) &&
  dateRanges(line.text).length === 0 &&
  !headingKind(line.text) &&
  // A group heading in capitals, such as "GROWTH", starts the bullets.
  /\p{Ll}/u.test(line.text);

/**
 * A job's title, company and place, from the lines around its dates: the dates' own line, then
 * up to three short lines after them, as a date rail down the side has them, or the line before
 * when the dates stand alone after it.
 */
function jobAt(lines: readonly Line[], index: number, range: DateRange, section: Section): Job {
  const line = lines[index] as Line;
  const without = (text: string) =>
    text.replace(range.text, ' ').replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, '');
  const split = (text: string) =>
    text
      .split(/\s+(?:\||·|—|–|@|at)\s+|\s*\|\s*/)
      .map((piece) => piece.trim())
      .filter(Boolean);
  const piecesAt = (at: number) => piecesOf(lines[at] as Line).flatMap(split);
  const here = piecesOf(line).map(without).filter(Boolean).flatMap(split);
  const after: string[] = [];
  for (let at = index + 1; at < Math.min(index + 4, section.end) && headerLike(lines[at]); at++)
    after.push(...piecesAt(at));
  const before =
    here.length === 0 && index - 1 > section.line && headerLike(lines[index - 1])
      ? piecesAt(index - 1)
      : [];
  const candidates = [...here, ...after, ...before];
  const location =
    candidates.find((piece) => PLACE.test(piece) && piece.split(' ').length <= 5) ?? null;
  const rest = candidates.filter((piece) => piece !== location);
  // A title has words such as "Manager". Without one, the title comes first, as most resumes have it.
  const title = rest.find((piece) => TITLE_WORDS.test(piece)) ?? rest[0] ?? null;
  const company = rest.find((piece) => piece !== title) ?? null;
  return { title, company, location, dates: range, line: index };
}

/**
 * The jobs in the experience sections: one for each span of dates on a line of its own or
 * beside a title, with what's around it. A span inside a sentence, such as a bullet's "from 2019
 * to 2021", isn't a job's.
 */
function jobsIn(lines: readonly Line[], sections: readonly Section[]): Job[] {
  const experience = sectionsOf(sections, 'experience');
  return experience.flatMap((section) => {
    const jobs: Job[] = [];
    for (let index = section.line + 1; index < section.end; index++) {
      const line = lines[index] as Line;
      if (/[.;!?]$/.test(line.text) || line.text.split(/\s+/).length > 14) continue;
      for (const range of dateRanges(line.text)) jobs.push(jobAt(lines, index, range, section));
    }
    return jobs;
  });
}

/** A school's name without the place after it: "Boston University, Boston, MA" is the school. */
function withoutPlace(school: string): string {
  const place = school.match(PLACE);
  if (!place || place.index === undefined) return school;
  const before = school.slice(0, place.index).replace(/[\s,–—|·-]+$/, '');
  return SCHOOL.test(before) ? before : school;
}

/** The degrees and schools in the education sections. */
function educationIn(lines: readonly Line[], sections: readonly Section[]): School[] {
  const schools: School[] = [];
  for (const section of sectionsOf(sections, 'education')) {
    let current: School | null = null;
    // A date before a school's name, as a date rail down the side has it, is its date.
    let early: string | null = null;
    for (let index = section.line + 1; index < section.end; index++) {
      const text = (lines[index] as Line).text;
      let degree = text.match(DEGREE) ? (piecesOf(lines[index] as Line)[0] ?? text) : null;
      let school = SCHOOL.test(text)
        ? (piecesOf(lines[index] as Line).find((piece) => SCHOOL.test(piece)) ?? text)
        : null;
      // "B.S., Economics, University of Colorado, 2016" holds both: the degree comes before the
      // school's name.
      if (degree && school && degree === school) {
        const parts = text.split(/,\s*|\s+[|·—–]\s+/);
        const at = parts.findIndex((part) => SCHOOL.test(part));
        degree = parts.slice(0, Math.max(at, 1)).join(', ');
        school = parts[at] ?? school;
      }
      const dates = dateRanges(text)[0]?.text ?? singleDates(text)[0] ?? null;
      const startsNew =
        !current || (degree && current.degree) || (school && current.school && !degree);
      if ((degree || school) && startsNew) {
        current = { degree: null, school: null, dates: early, line: index };
        early = null;
        schools.push(current);
      }
      if (!degree && !school && dates && (!current || current.dates)) {
        early = dates;
        continue;
      }
      if (!current) continue;
      if (degree && !current.degree)
        current.degree = degree.replace(/[\s,–—-]*(?:19|20)\d{2}.*$/, '').trim();
      if (school && !current.school) current.school = withoutPlace(school);
      if (dates && !current.dates) current.dates = dates;
    }
  }
  return schools;
}

/** The skills listed in the skills sections, split at commas, dots and bars. */
function skillsIn(lines: readonly Line[], sections: readonly Section[]): string[] {
  const skills = new Map<string, string>();
  for (const section of sectionsOf(sections, 'skills')) {
    // Items side by side in columns read as one line, so each piece is its own. A piece that
    // starts in lowercase goes on from the one before, as a list wrapped onto the next line does.
    const pieces: string[] = [];
    for (let index = section.line + 1; index < section.end; index++) {
      for (const piece of piecesOf(lines[index] as Line)) {
        const last = pieces.length - 1;
        if (last >= 0 && /^\p{Ll}/u.test(piece) && !/[·•,;|]$/.test(pieces[last] ?? ''))
          pieces[last] = `${pieces[last]} ${piece}`;
        else pieces.push(piece);
      }
    }
    for (const piece of pieces) {
      const text = piece.replace(/^[^:]{1,40}:\s+/, '');
      for (const item of text.split(/\s*[·•,;|]\s*|\s+[–—-]\s+|^[–—-]\s+/)) {
        const skill = item.replace(/^[\s–—•·-]+|[\s.]+$/g, '');
        if (skill && skill.split(/\s+/).length <= 5 && !skills.has(skill.toLowerCase()))
          skills.set(skill.toLowerCase(), skill);
      }
    }
  }
  return [...skills.values()];
}

/**
 * What a parser fills in, the way most do it: the name from the top, contact details by their
 * patterns, each job from a span of dates in the experience section with the title and company
 * beside or under it, schools from the education section, and skills from the skills section.
 */
export function readFields(lines: readonly Line[], sections: readonly Section[]): Fields {
  const firstHeading = sections[0]?.line ?? lines.length;
  // Contact details are at the top, or under a heading of their own, as in a sidebar.
  const top = [
    ...lines.slice(0, Math.max(firstHeading, Math.min(6, lines.length))),
    ...sectionsOf(sections, 'contact').flatMap((section) =>
      lines.slice(section.line + 1, section.end),
    ),
  ];
  const nameLine = top.findIndex((line) => nameIn(line.text) !== null);
  const all = lines.map((line) => line.text);
  const firstOf = <T>(find: (text: string) => T | null) => {
    for (const text of [...top.map((line) => line.text), ...all]) {
      const found = find(text);
      if (found) return found;
    }
    return null;
  };
  const links = new Set<string>();
  for (const text of top.map((line) => line.text)) {
    if (text.length > MAX_CONTACT_LINE) continue;
    for (const match of text.matchAll(LINK)) if (!EMAIL.test(match[0])) links.add(match[0]);
  }
  return {
    name: nameLine >= 0 ? nameIn((top[nameLine] as Line).text) : null,
    nameLine: nameLine >= 0 ? nameLine : null,
    email: firstOf((text) =>
      text.includes('@') && text.length <= MAX_CONTACT_LINE
        ? (text.match(EMAIL)?.[0] ?? null)
        : null,
    ),
    phone: firstOf(phoneIn),
    location: top.map((line) => line.text.match(PLACE)?.[0] ?? null).find(Boolean) ?? null,
    links: [...links].filter((link) => !/@/.test(link)),
    jobs: jobsIn(lines, sections),
    education: educationIn(lines, sections),
    skills: skillsIn(lines, sections),
  };
}
