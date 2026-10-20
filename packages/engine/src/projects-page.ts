import { type Check, contactCheck, isObject, list, shape, text } from './checks.ts';
import { type Contact, FORMATS } from './schema.ts';
import { TEMPLATE_ID } from './templates.ts';

/**
 * How a Projects page lays its projects out: a list, each like a job on the resume; cards, two
 * across; or short case studies, each with what it set out to do, what the user did, and what
 * came of it.
 */
export const PAGE_SHAPES = ['list', 'cards', 'case-studies'] as const;
export type PageShape = (typeof PAGE_SHAPES)[number];

/** One project on the page. */
export interface PageProject {
  name: string;
  /** What kind it is and the user's part, such as "App for iPhone and Android · built it alone". */
  line?: string;
  /** When, as it prints, such as "2023 – Present". */
  when?: string;
  /** Its website, store page or repository, as it prints. */
  link?: string;
  /** What it is, in a sentence or two. */
  what?: string;
  /** What the user did and what came of it, a line each, each group under a heading or none. */
  points?: { heading?: string; items: string[] }[];
  skills?: string[];
}

/**
 * A Projects page, as the projects-page skill writes it in a job's projects-page.json: the same
 * header as the job's resume, so the two look like a set, then the user's projects in more depth
 * than a resume has room for, on one page. Any text can hold **bold** and [[placeholders]],
 * which lint refuses, so none ship by accident.
 */
export interface ProjectsPage {
  /** Its template's ID. Without one, it takes the job's resume's. */
  layout?: string;
  format?: string;
  /** The files' name, without an extension, such as "AlexRiveraProjects10202026_Acme". */
  output_name?: string;
  name: string;
  headline?: string;
  tagline?: string;
  contact?: Contact;
  /** The page's heading, such as "Selected Projects". "Projects" when unset. */
  heading?: string;
  /** A line under the heading, such as what the projects show together. */
  intro?: string;
  shape?: PageShape;
  projects: PageProject[];
}

/** The heading over the projects, unless the page names its own. */
export const DEFAULT_PAGE_HEADING = 'Projects';

const CHECKS: Record<string, Check> = {
  layout: text(false),
  format: text(false),
  output_name: text(false),
  name: text(true),
  headline: text(false),
  tagline: text(false),
  contact: contactCheck,
  heading: text(false),
  intro: text(false),
  shape: text(false),
  projects: list(
    shape({
      name: text(true),
      line: text(false),
      when: text(false),
      link: text(false),
      what: text(false),
      points: list(shape({ heading: text(false), items: list(text(true), true) })),
      skills: list(text(true)),
    }),
    true,
  ),
};

/** The fields a Projects page can have at its top level, such as projects. */
export const PAGE_FIELDS = Object.keys(CHECKS);

/**
 * Checks a Projects page before it's built, so a mistake reads as a plain problem rather than a
 * failed build: "page.projects[0].name is missing."
 */
export function readProjectsPage(
  value: unknown,
): { ok: true; page: ProjectsPage } | { ok: false; problems: string[] } {
  if (!isObject(value)) return { ok: false, problems: ['The page should be a JSON object.'] };
  const problems: string[] = [];
  for (const [key, check] of Object.entries(CHECKS)) check(value[key], `page.${key}`, problems);
  if (Array.isArray(value.projects) && value.projects.length === 0) {
    problems.push('page.projects should hold the projects, one each.');
  }
  if (typeof value.layout === 'string' && !TEMPLATE_ID.test(value.layout)) {
    problems.push('page.layout should be a template’s ID, such as classic or minimal.');
  }
  if (typeof value.format === 'string' && !(FORMATS as readonly string[]).includes(value.format)) {
    problems.push(`page.format should be ${FORMATS.join(', ')}.`);
  }
  if (
    typeof value.shape === 'string' &&
    !(PAGE_SHAPES as readonly string[]).includes(value.shape)
  ) {
    problems.push(`page.shape should be ${PAGE_SHAPES.join(', ')}.`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, page: withoutNulls(value) as unknown as ProjectsPage };
}

/**
 * A page's fields with the ones that are null left out, at every depth, as the checks take a null
 * as no value: so printing it never meets one.
 */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, each]) => each !== null)
      .map(([key, each]) => [key, withoutNulls(each)]),
  );
}
