import { type Check, contactCheck, isObject, list, shape, text, yesOrNo } from './checks.ts';
import { TEMPLATE_ID } from './templates.ts';

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

/** A degree, diploma or course of study. */
export interface Education {
  /** Such as "B.S., Computer Science" or "MBA". */
  degree: string;
  school: string;
  location?: string;
  start?: string;
  /** When it ended, such as "2019", or how it stands, as the user's rules word it. */
  end?: string;
  /** Honors, a minor or a thesis, on a line of its own. */
  note?: string;
}

/**
 * One resume, as the skills write it in a job's resume.json. Any text can hold **bold** and
 * [[placeholders]], which lint refuses, so none ship by accident.
 */
export interface Resume {
  /** Its template's ID: a built-in one, such as "classic", the default, or one of the user's own. */
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
  /** The heading over the projects. "Independent Projects" when unset. */
  projects_heading?: string;
  projects?: { name: string; status?: string; url?: string; text: string }[];
  education?: Education[];
  /** Education before the experience, as early in a career it says the most. */
  education_first?: boolean;
  /** The heading over the skills, such as "Clinical Skills". Each template has its own default. */
  skills_heading?: string;
  skills?: { category: string; items: string[] }[];
  extra_sections?: { heading: string; items: string[] }[];
}

const CHECKS: Record<string, Check> = {
  layout: text(false),
  format: text(false),
  output_name: text(false),
  name: text(true),
  headline: text(true),
  tagline: text(false),
  contact: contactCheck,
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
  projects_heading: text(false),
  projects: list(
    shape({ name: text(true), status: text(false), url: text(false), text: text(true) }),
  ),
  education: list(
    shape({
      degree: text(true),
      school: text(true),
      location: text(false),
      start: text(false),
      end: text(false),
      note: text(false),
    }),
  ),
  education_first: yesOrNo,
  skills_heading: text(false),
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
  if (typeof value.layout === 'string' && !TEMPLATE_ID.test(value.layout)) {
    problems.push('resume.layout should be a template’s ID, such as classic or minimal.');
  }
  if (typeof value.format === 'string' && !(FORMATS as readonly string[]).includes(value.format)) {
    problems.push(`resume.format should be ${FORMATS.join(', ')}.`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, resume: value as unknown as Resume };
}
