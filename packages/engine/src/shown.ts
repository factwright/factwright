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
 * The parts of a resume a template's look can have no place for, as resume.json names them. A
 * template made from a resume the user likes has only that resume's parts, so it can have no
 * band of numbers, no highlight cards, or no headings over a job's bullets. A resume in it leaves
 * those out too, so it looks like the template, and the Word file holds no more than the PDF.
 */
export const OPTIONAL_PARTS = [
  'tagline',
  'impact_stats',
  'competencies',
  'systems',
  'experience[].company_note',
  'experience[].location',
  'experience[].intro',
  'experience[].bullet_groups[].heading',
  'experience[].bullet_groups[].bullets[].lead',
  'education',
  'education[].note',
  'skills',
] as const;
export type OptionalPart = (typeof OPTIONAL_PARTS)[number];

/**
 * A resume with the text of each optional part it has swapped for a marker, and the part each
 * marker stands for. A marker is letters and digits, the same once made safe for the page and
 * marked up, and ends in "x", so none is the start of another.
 */
function marked(resume: Resume): { resume: Resume; marks: [OptionalPart, string][] } {
  const marks: [OptionalPart, string][] = [];
  const mark = (part: OptionalPart) => {
    const marker = `fwpart${marks.length}x`;
    marks.push([part, marker]);
    return marker;
  };
  const maybe = (value: string | undefined, part: OptionalPart) => (value ? mark(part) : value);
  return {
    resume: {
      ...resume,
      tagline: maybe(resume.tagline, 'tagline'),
      impact_stats: resume.impact_stats?.map((stat) => ({ ...stat, value: mark('impact_stats') })),
      competencies: resume.competencies?.map(() => mark('competencies')),
      systems: resume.systems?.map((card) => ({ ...card, name: mark('systems') })),
      experience: resume.experience.map((job) => ({
        ...job,
        company_note: maybe(job.company_note, 'experience[].company_note'),
        location: maybe(job.location, 'experience[].location'),
        intro: maybe(job.intro, 'experience[].intro'),
        bullet_groups: job.bullet_groups?.map((group) => ({
          heading: maybe(group.heading, 'experience[].bullet_groups[].heading'),
          bullets: group.bullets.map((bullet) => ({
            ...bullet,
            lead: maybe(bullet.lead, 'experience[].bullet_groups[].bullets[].lead'),
          })),
        })),
      })),
      education: resume.education?.map((school) => ({
        ...school,
        degree: mark('education'),
        note: maybe(school.note, 'education[].note'),
      })),
      skills: resume.skills?.map((line) => ({
        ...line,
        items: line.items.map(() => mark('skills')),
      })),
    },
    marks,
  };
}

/**
 * The optional parts this resume has that a template's page never shows, because its look has
 * no place for them, in the order a page has them. Read from the page's text alone, never its
 * tags or their attributes, where a value doesn't print.
 */
export function partsLeftOut(template: Template, resume: Resume): OptionalPart[] {
  const { resume: markedResume, marks } = marked(resume);
  const text = renderBody(template, markedResume).replace(/<[^>]*>/g, ' ');
  const missing = new Set(
    marks.filter(([, marker]) => !text.includes(marker)).map(([part]) => part),
  );
  return OPTIONAL_PARTS.filter((part) => missing.has(part));
}

/**
 * The optional parts a template has no place for, read from the made-up resume the gallery
 * shows, with a job's intro and a degree's note added, so it has every one.
 */
export function templateHasNoPlaceFor(template: Template): OptionalPart[] {
  const resume = previewResume();
  return partsLeftOut(template, {
    ...resume,
    experience: resume.experience.map((job, i) => (i === 0 ? { ...job, intro: 'Intro' } : job)),
    education: (resume.education ?? []).map((school) => ({ ...school, note: 'Note' })),
  });
}

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
