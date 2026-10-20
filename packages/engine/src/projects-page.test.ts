import { describe, expect, it } from 'vitest';
import { projectsDocxFile } from './docx.ts';
import { outputName } from './files.ts';
import { renderProjectsHtml } from './html.ts';
import { lintProjectsPage } from './lint.ts';
import { type ProjectsPage, readProjectsPage } from './projects-page.ts';
import { builtInTemplate, type Template } from './templates.ts';

const page: ProjectsPage = {
  layout: 'classic',
  output_name: 'AlexRiveraProjects10202026_Acme',
  name: 'Alex Rivera',
  headline: 'Staff Platform Engineer',
  contact: { email: 'alex@example.com', location: 'Denver, CO' },
  heading: 'Selected Projects',
  shape: 'cards',
  projects: [
    {
      name: 'Trailhead',
      line: 'App for iPhone and Android · built it alone',
      when: '2023 – Present',
      link: 'trailhead.example.com',
      what: 'A free app that maps trail conditions from hikers’ reports.',
      points: [{ items: ['Grew it to about **4,000** monthly users.'] }],
      skills: ['React Native', 'PostgreSQL'],
    },
    { name: 'Code Club', what: 'Free Saturday coding classes.' },
  ],
};

const classic = () => builtInTemplate('classic') as Template;

describe('readProjectsPage', () => {
  it('takes a page that holds up', () => {
    expect(readProjectsPage(page)).toEqual({ ok: true, page });
  });

  it('says what doesn’t hold up, in plain words', () => {
    const read = readProjectsPage({
      ...page,
      name: undefined,
      layout: 'Not An ID',
      shape: 'slides',
      projects: [{ what: 'No name' }, { name: 'Two', points: [{ items: [] }] }],
    });
    expect(read.ok ? [] : read.problems).toEqual([
      'page.name is missing.',
      'page.projects[0].name is missing.',
      'page.layout should be a template’s ID, such as classic or minimal.',
      'page.shape should be list, cards, case-studies.',
    ]);
    expect(readProjectsPage({ ...page, projects: [] })).toEqual({
      ok: false,
      problems: ['page.projects should hold the projects, one each.'],
    });
    expect(readProjectsPage('a page')).toEqual({
      ok: false,
      problems: ['The page should be a JSON object.'],
    });
  });
});

describe('renderProjectsHtml', () => {
  it('prints the page under the resume’s own header, in its shape', () => {
    const html = renderProjectsHtml(page, classic());
    expect(html).toContain('<title>Alex Rivera — Projects</title>');
    expect(html).toContain('<div class="name">Alex Rivera</div>');
    expect(html).toContain('<section class="pp pp-cards"><h2>Selected Projects</h2>');
    expect(html).toContain(
      '<div class="title">Trailhead</div><div class="when">2023 – Present</div>',
    );
    expect(html).toContain(
      '<div class="co">App for iPhone and Android · built it alone</div><div class="co">trailhead.example.com</div>',
    );
    expect(html).toContain('<li>Grew it to about <strong>4,000</strong> monthly users.</li>');
    expect(html).toContain('<div class="pp-skills">React Native · PostgreSQL</div>');
    // A project with no line, link or tools leaves their rows out.
    const club = html.slice(html.indexOf('Code Club'));
    expect(club).not.toContain('class="co"');
    expect(club).not.toContain('pp-skills');
    // The template's own styles, between how the pieces sit and how each shape lays them out.
    expect(html.indexOf('.row{display:flex')).toBeLessThan(html.indexOf('--rule:#2b2f36'));
    expect(html.indexOf('--rule:#2b2f36')).toBeLessThan(html.indexOf('.pp-cards .pp-items'));
  });

  it('says Projects, as a list, when the page doesn’t say', () => {
    const html = renderProjectsHtml({ ...page, heading: undefined, shape: undefined }, classic());
    expect(html).toContain('<section class="pp pp-list"><h2>Projects</h2>');
  });

  it('gives a template without header parts a plain header, in its fonts and colors', () => {
    const own: Template = { ...classic(), id: 'own', parts: {}, body: '<p>{{name}}</p>' };
    const html = renderProjectsHtml(page, own);
    expect(html).toContain('<div class="hdr"><div class="name">Alex Rivera</div>');
    expect(html).toContain('<div class="title">Trailhead</div>');
    // Not the template's own styles, which may lay a page out in ways this one can't follow.
    expect(html).not.toContain('--rule:#2b2f36');
  });
});

describe('the rest of a Projects page', () => {
  it('builds a Word file', async () => {
    const bytes = new Uint8Array(await projectsDocxFile(page, classic()));
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
  });

  it('checks the page against the user’s rules', () => {
    expect(lintProjectsPage(page, {}, ['Bluebird'])).toEqual([]);
    const leaky = { ...page, intro: 'Built for [[Bluebird]].' };
    expect(lintProjectsPage(leaky, {}, ['Bluebird'])).toEqual([
      'A [[placeholder]] is still in the Projects page.',
      'A confidential term matching "Bluebird" is in the Projects page.',
    ]);
  });

  it('names its files for the person, what it is and the date', () => {
    expect(outputName({ name: 'Alex Rivera' }, new Date(2026, 9, 20), 'Projects')).toBe(
      'AlexRiveraProjects10202026',
    );
  });
});
