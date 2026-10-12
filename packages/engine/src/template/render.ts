import type { Resume } from '../schema.ts';
import type { Template } from '../templates.ts';
import { type Node, parseTemplate, renderNodes } from './syntax.ts';
import { type ResumeTitles, resumeView } from './view.ts';

/** The heading over the systems cards, unless the resume names its own. */
export const DEFAULT_SYSTEMS_HEADING = 'Key Systems';

/** The heading over the projects, unless the resume names its own. */
export const DEFAULT_PROJECTS_HEADING = 'Independent Projects';

/** What a template calls each part of one resume, with the headings the resume names itself. */
export function sectionTitles(template: Template, resume: Resume): ResumeTitles {
  return {
    ...template.titles,
    skills: resume.skills_heading || template.titles.skills,
    systems: resume.systems_heading || DEFAULT_SYSTEMS_HEADING,
    projects: resume.projects_heading || DEFAULT_PROJECTS_HEADING,
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
