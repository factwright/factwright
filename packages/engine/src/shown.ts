import { escapeHtml, md } from './markup.ts';
import { previewResume } from './sample.ts';
import type { Resume } from './schema.ts';
import { renderBody } from './template/render.ts';
import type { Template } from './templates.ts';

/**
 * What of a resume a page's body leaves out, of the parts a template of the user's own can drop
 * without anyone seeing: its projects, and its extra sections, such as a line of interests. Each
 * in words, such as "the projects" or "the Interests section", or none when they all show. The
 * body alone, as the template made it, never the page's fonts or styles, which could hold a
 * project's name by chance.
 */
export function leftOut(
  body: string,
  resume: Pick<Resume, 'projects' | 'extra_sections'>,
): string[] {
  const missing: string[] = [];
  const projects = resume.projects ?? [];
  // As the page shows a project's name: marked up, as **bold** can be.
  const hidden = projects.filter((project) => !body.includes(md(project.name)));
  if (hidden.length > 0) {
    missing.push(
      hidden.length === projects.length
        ? 'the projects'
        : `the projects ${hidden.map((project) => `“${project.name}”`).join(', ')}`,
    );
  }
  for (const section of resume.extra_sections ?? []) {
    const shown =
      body.includes(escapeHtml(section.heading)) &&
      section.items.every((item) => body.includes(md(item)));
    if (!shown) missing.push(`the ${section.heading} section`);
  }
  return missing;
}

/** What a template would leave out of this resume, of its projects and extra sections. */
export const resumeLeavesOut = (template: Template, resume: Resume): string[] =>
  leftOut(renderBody(template, resume), resume);

/**
 * What a template leaves out of a resume that has projects and an extra section, such as one of
 * the user's own made before resumes had them to show, or none when it shows them both.
 */
export function templateLeavesOut(template: Template): string[] {
  const resume: Resume = {
    ...previewResume(),
    projects: [
      {
        name: 'Riverside Reading Club',
        status: 'Live',
        url: 'example.org',
        text: 'Free reading hours for kids at the public library.',
      },
    ],
    extra_sections: [{ heading: 'Interests', items: ['Trail running', 'Chess'] }],
  };
  return resumeLeavesOut(template, resume);
}
