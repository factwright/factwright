import { describe, expect, it } from 'vitest';
import { previewResume } from './sample.ts';
import { leftOut, partsLeftOut, templateHasNoPlaceFor, templateLeavesOut } from './shown.ts';
import { builtInTemplate, type Template } from './templates.ts';

const classic = () => builtInTemplate('classic') as Template;

describe('leftOut', () => {
  const resume = {
    projects: [
      { name: 'Trailhead', text: 'A trail app.' },
      { name: 'R&D Club', text: 'A club.' },
    ],
    extra_sections: [{ heading: 'Interests', items: ['**Trail** running'] }],
  };

  it('finds nothing missing on a page that shows it all', () => {
    const page =
      '<div>Trailhead</div><div>R&amp;D Club</div><h2>Interests</h2><li><strong>Trail</strong> running</li>';
    expect(leftOut(page, resume)).toEqual([]);
  });

  it('finds a name marked up as the page shows it, and never in a page’s other text', () => {
    const bold = { projects: [{ name: '**Go** club', text: 'A club.' }] };
    expect(leftOut('<div><strong>Go</strong> club</div>', bold)).toEqual([]);
    // A short name is often somewhere in a page's fonts or styles: only the body counts.
    const short = { projects: [{ name: 'Go', text: 'A language.' }] };
    expect(leftOut('<section><h2>Skills</h2></section>', short)).toEqual(['the projects']);
  });

  it('names what a page leaves out', () => {
    expect(leftOut('<h2>Interests</h2>', resume)).toEqual([
      'the projects',
      'the Interests section',
    ]);
    expect(leftOut('<div>Trailhead</div>', resume)).toEqual([
      'the projects “R&D Club”',
      'the Interests section',
    ]);
    expect(leftOut('', {})).toEqual([]);
  });
});

describe('templateLeavesOut', () => {
  it('finds the app’s own templates show everything', () => {
    for (const id of ['classic', 'minimal']) {
      expect(templateLeavesOut(builtInTemplate(id) as Template)).toEqual([]);
    }
  });

  it('names what a template of the user’s own drops', () => {
    const body = classic().body.replace(
      /\{\{#extra_sections\}\}[\s\S]*?\{\{\/extra_sections\}\}/,
      '',
    );
    expect(templateLeavesOut({ ...classic(), body })).toEqual(['the Interests section']);
  });
});

describe('templateHasNoPlaceFor', () => {
  it('finds the app’s own templates have a place for every part', () => {
    for (const id of ['classic', 'minimal']) {
      expect(templateHasNoPlaceFor(builtInTemplate(id) as Template)).toEqual([]);
    }
  });

  it('names the parts a look has no place for, in the order a page has them', () => {
    // As a template made from a resume with no numbers, cards, tagline or bullet headings has it.
    const parts = {
      ...classic().parts,
      header: '<div class="name">{{name}}</div><div class="headline">{{headline}}</div>',
      stats: '',
      'job-body':
        '{{#intro}}<div class="intro">{{intro}}</div>{{/intro}}{{#groups}}<ul class="b">{{#bullets}}<li>{{text}}</li>{{/bullets}}</ul>{{/groups}}',
    };
    const body = classic().body.replace(
      /\{\{#systems\.length\}\}[\s\S]*?\{\{\/systems\.length\}\}/,
      '',
    );
    expect(templateHasNoPlaceFor({ ...classic(), body, parts })).toEqual([
      'tagline',
      'impact_stats',
      'systems',
      'experience[].bullet_groups[].heading',
      'experience[].bullet_groups[].bullets[].lead',
    ]);
  });

  it('counts a part as shown only when it prints, never inside a tag', () => {
    const parts = {
      ...classic().parts,
      header: '<div class="name" data-tagline="{{tagline}}">{{name}}</div>{{headline}}',
    };
    expect(templateHasNoPlaceFor({ ...classic(), parts })).toEqual(['tagline']);
  });
});

describe('partsLeftOut', () => {
  const noNumbers = () => ({ ...classic(), parts: { ...classic().parts, stats: '' } });

  it('names only the parts the resume has', () => {
    const resume = previewResume();
    expect(partsLeftOut(noNumbers(), resume)).toEqual(['impact_stats']);
    expect(partsLeftOut(noNumbers(), { ...resume, impact_stats: [] })).toEqual([]);
    const { impact_stats: _, ...none } = resume;
    expect(partsLeftOut(noNumbers(), none)).toEqual([]);
  });

  it('finds every part the app’s own templates print, wherever education goes', () => {
    const resume = { ...previewResume(), education_first: true };
    expect(partsLeftOut(classic(), resume)).toEqual([]);
    expect(partsLeftOut(builtInTemplate('minimal') as Template, resume)).toEqual([]);
  });
});
