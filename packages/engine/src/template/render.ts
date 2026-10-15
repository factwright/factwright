import { plainLetter } from '../built-in/plain-letter.ts';
import type { CoverLetter } from '../letter.ts';
import type { Resume } from '../schema.ts';
import type { LetterLayout, Template } from '../templates.ts';
import { markAttributeValues } from './check.ts';
import { type Node, parseTemplate, renderNodes } from './syntax.ts';
import { letterView, type ResumeTitles, resumeView } from './view.ts';

/** The heading over the systems cards, unless the resume names its own. */
export const DEFAULT_SYSTEMS_HEADING = 'Key Systems';

/** The heading over the projects, unless the resume names its own. */
export const DEFAULT_PROJECTS_HEADING = 'Independent Projects';

/** What a template calls each part of one resume, with the headings the resume names itself. */
export function sectionTitles(
  template: Template,
  resume: Pick<Resume, 'skills_heading' | 'systems_heading' | 'projects_heading'>,
): ResumeTitles {
  return {
    ...template.titles,
    skills: resume.skills_heading || template.titles.skills,
    systems: resume.systems_heading || DEFAULT_SYSTEMS_HEADING,
    projects: resume.projects_heading || DEFAULT_PROJECTS_HEADING,
    highlights: template.titles.highlights || 'Highlights',
    contact: template.titles.contact || 'Contact',
  };
}

interface Parsed {
  body: Node[];
  parts: Map<string, Node[]>;
}

const parsed = new WeakMap<Template, Parsed>();

function parse(source: string, where: string): Node[] {
  const read = parseTemplate(source, where);
  if (!read.ok) throw new Error(read.problems.join(' '));
  markAttributeValues(read.nodes);
  return read.nodes;
}

/** A template's markup, parsed once. A template from the user's workspace was checked already. */
function parsedOf(template: Template): Parsed {
  let done = parsed.get(template);
  if (!done) {
    done = {
      body: parse(template.body, `The ${template.name} template`),
      parts: new Map(
        Object.entries(template.parts).map(([name, source]) => [
          name,
          parse(source, `The ${template.name} template’s ${name} part`),
        ]),
      ),
    };
    parsed.set(template, done);
  }
  return done;
}

/** A resume's page in a template: its markup, filled in. */
export function renderBody(template: Template, resume: Resume): string {
  const { body, parts } = parsedOf(template);
  return renderNodes(body, [resumeView(resume, sectionTitles(template, resume))], parts);
}

interface ParsedLetter {
  layout: LetterLayout;
  /** Whether it's the template's own, which prints with the template's styles and parts. */
  own: boolean;
  body: Node[];
}

const letters = new WeakMap<Template, ParsedLetter>();

/**
 * What a template's cover letters print with: its own letter layout, or else a plain one in its
 * fonts and colors, parsed once.
 */
function letterOf(template: Template): ParsedLetter {
  let done = letters.get(template);
  if (!done) {
    const own = template.letter !== undefined;
    const layout = template.letter ?? plainLetter(template);
    done = { layout, own, body: parse(layout.body, `The ${template.name} template’s letter`) };
    letters.set(template, done);
  }
  return done;
}

/**
 * The styles a template's letters print with: the template's own and its letter's, so the
 * letter's header is styled as the resume's is, or only the plain letter's.
 */
export function letterStyles(template: Template): string {
  const { layout, own } = letterOf(template);
  return own ? `${template.css}\n${layout.css}` : layout.css;
}

/** A cover letter's page in a template: its letter's markup, filled in. */
export function renderLetterBody(template: Template, letter: CoverLetter): string {
  const { body, own } = letterOf(template);
  const parts = own ? parsedOf(template).parts : new Map<string, Node[]>();
  return renderNodes(body, [letterView(letter, sectionTitles(template, {}))], parts);
}
