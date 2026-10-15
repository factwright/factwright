import type { Line } from './read.ts';

/** The parts of a resume a parser looks for by their headings. */
export type SectionKind =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'awards'
  | 'publications'
  | 'volunteering'
  | 'languages'
  | 'interests'
  | 'references'
  | 'affiliations'
  | 'courses'
  | 'contact';

/** What each kind is called on screen. */
export const SECTION_NAMES: Readonly<Record<SectionKind, string>> = {
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certifications: 'Certifications',
  awards: 'Awards',
  publications: 'Publications',
  volunteering: 'Volunteering',
  languages: 'Languages',
  interests: 'Interests',
  references: 'References',
  affiliations: 'Affiliations',
  courses: 'Courses',
  contact: 'Contact',
};

/**
 * The headings parsers know, by kind, written as `normalized` makes them: lowercase, "&" as
 * "and", and no punctuation. A heading counts only when it's the whole line.
 */
const HEADINGS: Readonly<Record<SectionKind, readonly string[]>> = {
  summary: [
    'summary',
    'professional summary',
    'career summary',
    'executive summary',
    'summary of qualifications',
    'qualifications summary',
    'profile',
    'professional profile',
    'career profile',
    'about',
    'about me',
    'objective',
    'career objective',
    'professional objective',
    'overview',
    'professional overview',
    'introduction',
  ],
  experience: [
    'experience',
    'work experience',
    'professional experience',
    'relevant experience',
    'employment',
    'employment history',
    'work history',
    'career history',
    'professional history',
    'professional background',
    'career experience',
    'positions held',
  ],
  education: [
    'education',
    'academic background',
    'academic history',
    'academics',
    'education and training',
    'education and certifications',
    'education and certification',
    'education and credentials',
    'degrees',
  ],
  skills: [
    'skills',
    'core skills',
    'key skills',
    'skills summary',
    'summary of skills',
    'skill set',
    'skillset',
    'competencies',
    'core competencies',
    'key competencies',
    'areas of expertise',
    'expertise',
    'strengths',
    'key strengths',
    'specialties',
    'tools',
    'tools and technologies',
    'technologies',
    'tech stack',
    'technical proficiencies',
    'proficiencies',
    'qualifications',
    'capabilities',
  ],
  projects: ['projects', 'key projects', 'selected projects', 'portfolio'],
  certifications: [
    'certifications',
    'certification',
    'certificates',
    'licenses',
    'licenses and certifications',
    'certifications and licenses',
    'credentials',
  ],
  awards: [
    'awards',
    'honors',
    'honors and awards',
    'awards and honors',
    'achievements',
    'accomplishments',
    'recognition',
  ],
  publications: [
    'publications',
    'presentations',
    'publications and presentations',
    'talks',
    'speaking',
    'patents',
  ],
  volunteering: [
    'volunteering',
    'volunteer',
    'volunteer work',
    'volunteer experience',
    'community involvement',
    'community service',
    'leadership and service',
  ],
  languages: ['languages', 'language skills', 'spoken languages'],
  interests: ['interests', 'hobbies', 'hobbies and interests', 'personal interests'],
  references: ['references'],
  affiliations: [
    'affiliations',
    'professional affiliations',
    'memberships',
    'professional memberships',
    'associations',
  ],
  courses: [
    'courses',
    'coursework',
    'relevant coursework',
    'training',
    'continuing education',
    'professional development',
  ],
  contact: ['contact', 'contact information', 'contact details', 'contact info'],
};

/** Headings by how they end, for names such as "Clinical Skills" or "Teaching Experience". */
const ENDINGS: readonly [RegExp, SectionKind][] = [
  [/ skills$/, 'skills'],
  [/ experience$/, 'experience'],
  [/ projects$/, 'projects'],
  [/ (?:certifications|licenses)$/, 'certifications'],
  [/^education /, 'education'],
  [/ (?:awards|honors)$/, 'awards'],
  [/ publications$/, 'publications'],
];

const KNOWN = new Map<string, SectionKind>(
  (Object.entries(HEADINGS) as [SectionKind, readonly string[]][]).flatMap(([kind, names]) =>
    names.map((name) => [name, kind] as const),
  ),
);

/** A heading as the list above writes it. */
export const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The kind of section a line heads, when it's a heading parsers know, or null. */
export function headingKind(text: string): SectionKind | null {
  if (text.length > 60) return null;
  const name = normalized(text);
  if (!name || name.split(' ').length > 6) return null;
  const known = KNOWN.get(name);
  if (known) return known;
  for (const [ending, kind] of ENDINGS) if (ending.test(name)) return kind;
  return null;
}

/** A part of the resume under one heading. */
export interface Section {
  /** What a parser takes it for, or null for a heading it doesn't know. */
  kind: SectionKind | null;
  /** The heading as the file has it. */
  title: string;
  /** Its heading's line, and the line after its last one. */
  line: number;
  end: number;
}

/** A line that could be a heading by its shape: short, with words, and not a sentence. */
const headingShaped = (line: Line) =>
  line.text.length <= 48 &&
  /\p{L}/u.test(line.text) &&
  line.text.split(/\s+/).length <= 6 &&
  !/[.,;]$/.test(line.text) &&
  line.part !== 'header' &&
  line.part !== 'footer';

/** The size most of the text is set in, by how much text each size has. */
function bodySize(lines: readonly Line[]): number {
  const sizes = new Map<number, number>();
  for (const line of lines) sizes.set(line.size, (sizes.get(line.size) ?? 0) + line.text.length);
  return [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

const inCapitals = (text: string) => /\p{L}/u.test(text) && !/\p{Ll}/u.test(text);

/**
 * The sections a parser finds: each line that's a heading it knows, and each line set exactly
 * like those, such as "Selected Work" in the same type as "Experience", which it can't place.
 * Headings set the same way as at least one other are headings. So is one in capitals or larger
 * than the text. A line with a known name set like the text around it, such as a "Projects"
 * subheading inside a job, isn't taken for a section.
 */
export function findSections(lines: readonly Line[]): Section[] {
  const known = lines.flatMap((line, index) => {
    const kind = headingShaped(line) ? headingKind(line.text) : null;
    return kind ? [{ index, kind, look: line.look }] : [];
  });
  const counts = new Map<string, number>();
  for (const { look } of known) counts.set(look, (counts.get(look) ?? 0) + 1);
  const looks = new Set([...counts].filter(([, count]) => count >= 2).map(([look]) => look));
  const body = bodySize(lines);
  const standsOut = (line: Line) => inCapitals(line.text) || line.size >= body + 0.5;

  const starts: { line: number; kind: SectionKind | null }[] = [];
  for (const [index, line] of lines.entries()) {
    const kind = known.find((each) => each.index === index)?.kind ?? null;
    if (kind && (looks.size === 0 || looks.has(line.look) || standsOut(line)))
      starts.push({ line: index, kind });
    else if (!kind && looks.has(line.look) && headingShaped(line))
      starts.push({ line: index, kind: null });
  }
  return starts.map((start, i) => ({
    kind: start.kind,
    title: lines[start.line]?.text ?? '',
    line: start.line,
    end: starts[i + 1]?.line ?? lines.length,
  }));
}

/** Every section of a kind. */
export const sectionsOf = (sections: readonly Section[], kind: SectionKind) =>
  sections.filter((section) => section.kind === kind);
