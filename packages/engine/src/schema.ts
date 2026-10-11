/** The looks a resume can have. Timeline is the default. */
export const LAYOUTS = ['timeline', 'executive', 'modern'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** The files a build makes. PDF is the default. */
export const FORMATS = ['pdf', 'docx', 'both'] as const;
export type ResumeFormat = (typeof FORMATS)[number];

export interface Contact {
  phone?: string;
  email?: string;
  linkedin?: string;
  location?: string;
  website?: string;
}

export interface Bullet {
  /** A bold lead-in, such as "Copilot". */
  lead?: string;
  text: string;
}

export interface Experience {
  title: string;
  company: string;
  /** What the company does, shown after its name. */
  company_note?: string;
  location?: string;
  start: string;
  end: string;
  intro?: string;
  bullet_groups?: { heading?: string; bullets: Bullet[] }[];
}

/**
 * One resume, as the skills write it in a job's resume.json. Any text can hold **bold** and
 * [[placeholders]], which lint refuses, so none ship by accident.
 */
export interface Resume {
  layout?: string;
  format?: string;
  /** The files' name, without an extension. */
  output_name?: string;
  name: string;
  headline: string;
  tagline?: string;
  contact?: Contact;
  summary: string;
  impact_stats?: { value: string; label: string }[];
  competencies?: string[];
  /** The heading over the systems cards, such as "Key Systems Built at Acme". */
  systems_heading?: string;
  systems?: { name: string; text: string }[];
  experience: Experience[];
  projects?: { name: string; status?: string; url?: string; text: string }[];
  skills?: { category: string; items: string[] }[];
  extra_sections?: { heading: string; items: string[] }[];
}

type Check = (value: unknown, where: string, problems: string[]) => void;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(required: boolean): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
    } else if (typeof value !== 'string') {
      problems.push(`${where} should be text.`);
    }
  };
}

function list(item: Check, required = false): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
      return;
    }
    if (!Array.isArray(value)) {
      problems.push(`${where} should be a list.`);
      return;
    }
    for (const [i, each] of value.entries()) item(each, `${where}[${i}]`, problems);
  };
}

function shape(fields: Record<string, Check>, required = true): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
      return;
    }
    if (!isObject(value)) {
      problems.push(`${where} should be an object.`);
      return;
    }
    for (const [key, check] of Object.entries(fields))
      check(value[key], `${where}.${key}`, problems);
  };
}

const CHECKS: Record<string, Check> = {
  layout: text(false),
  format: text(false),
  output_name: text(false),
  name: text(true),
  headline: text(true),
  tagline: text(false),
  contact: shape(
    {
      phone: text(false),
      email: text(false),
      linkedin: text(false),
      location: text(false),
      website: text(false),
    },
    false,
  ),
  summary: text(true),
  impact_stats: list(shape({ value: text(true), label: text(true) })),
  competencies: list(text(true)),
  systems_heading: text(false),
  systems: list(shape({ name: text(true), text: text(true) })),
  experience: list(
    shape({
      title: text(true),
      company: text(true),
      company_note: text(false),
      location: text(false),
      start: text(true),
      end: text(true),
      intro: text(false),
      bullet_groups: list(
        shape({
          heading: text(false),
          bullets: list(shape({ lead: text(false), text: text(true) }), true),
        }),
      ),
    }),
    true,
  ),
  projects: list(
    shape({ name: text(true), status: text(false), url: text(false), text: text(true) }),
  ),
  skills: list(shape({ category: text(true), items: list(text(true), true) })),
  extra_sections: list(shape({ heading: text(true), items: list(text(true), true) })),
};

/** The fields a resume can have at its top level, such as output_name. */
export const RESUME_FIELDS = Object.keys(CHECKS);

/**
 * Checks resume data before it's built, so a mistake reads as a plain problem rather than a
 * failed build: "resume.experience[1].title is missing."
 */
export function readResume(
  value: unknown,
): { ok: true; resume: Resume } | { ok: false; problems: string[] } {
  if (!isObject(value)) return { ok: false, problems: ['The resume should be a JSON object.'] };
  const problems: string[] = [];
  for (const [key, check] of Object.entries(CHECKS)) check(value[key], `resume.${key}`, problems);
  if (typeof value.layout === 'string' && !(LAYOUTS as readonly string[]).includes(value.layout)) {
    problems.push(`resume.layout should be ${LAYOUTS.join(', ')}.`);
  }
  if (typeof value.format === 'string' && !(FORMATS as readonly string[]).includes(value.format)) {
    problems.push(`resume.format should be ${FORMATS.join(', ')}.`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, resume: value as unknown as Resume };
}
