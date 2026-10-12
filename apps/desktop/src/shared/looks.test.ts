import { describe, expect, it } from 'vitest';
import { readAnswers } from './about.ts';
import { suggestedFor, suggestLooks, templateName, templatesMarkdown } from './looks.ts';

const TEMPLATES = [
  { id: 'classic', name: 'Classic' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'timeline', name: 'Timeline' },
];

describe('suggestLooks', () => {
  it('suggests a template for each kind of company the user is aiming at', () => {
    const suggestions = suggestLooks({
      companies: ['startup', 'established'],
      fields: ['software'],
      levels: ['senior'],
    });
    expect(suggestions.map(({ layout, for: kind }) => [kind, layout])).toEqual([
      ['startup', 'minimal'],
      ['established', 'classic'],
    ]);
    expect(suggestions[0]?.why).toBe('Suits startups and your field');
    expect(suggestions[1]?.why).toBe('Suits established companies');
  });

  it('suits formal fields and public employers with the classic look, and design with the minimal one', () => {
    const [suggestion] = suggestLooks({
      companies: ['public'],
      fields: ['legal'],
      levels: ['mid'],
    });
    expect(suggestion?.layout).toBe('classic');
    expect(suggestLooks({ companies: [], fields: ['design'], levels: ['senior'] })).toEqual([
      { layout: 'minimal', for: 'any', why: 'Suits your field' },
    ]);
  });

  it('gives each kind of company its own template, and the kinds that suit one best get theirs', () => {
    const suggestions = suggestLooks({
      companies: ['public', 'established', 'startup'],
      fields: [],
      levels: [],
    });
    // Two templates for three kinds: the startups get the one that suits them, not what's left.
    expect(suggestions.map(({ layout, for: kind }) => [kind, layout])).toEqual([
      ['public', 'classic'],
      ['startup', 'minimal'],
    ]);
  });

  it('falls back to the safest look with nothing told', () => {
    expect(suggestLooks({ companies: [], fields: [], levels: [] })).toEqual([
      { layout: 'classic', for: 'any', why: 'A safe choice for any job' },
    ]);
  });

  it('says which kinds of company a template is suggested for', () => {
    const suggestions = suggestLooks({
      companies: ['startup', 'public'],
      fields: ['software'],
      levels: ['entry'],
    });
    expect(suggestedFor('minimal', suggestions)).toEqual(['startup']);
    expect(suggestedFor('classic', suggestions)).toEqual(['public']);
    expect(suggestedFor('timeline', suggestions)).toEqual([]);
  });
});

describe('templateName', () => {
  it('names a template from the user’s, or by its ID once it’s gone', () => {
    expect(templateName('timeline', TEMPLATES)).toBe('Timeline');
    expect(templateName('banner', TEMPLATES)).toBe('banner');
  });
});

describe('templatesMarkdown', () => {
  it('lists the picks for the resume skills, with length and files', () => {
    const text = templatesMarkdown(
      readAnswers({
        looks: [
          { layout: 'timeline', for: 'startup' },
          { layout: 'classic', for: 'established' },
        ],
        levels: ['entry'],
        format: 'both',
      }),
      TEMPLATES,
    );
    expect(text).toContain('| Timeline | `timeline` | Startups (the startup style) |');
    expect(text).toContain(
      '| Classic | `classic` | Established companies (the big-company style) |',
    );
    expect(text).toContain('- **Length:** one page, for their level.');
    expect(text).toContain(
      '- **Files:** Both (PDF and Word), unless a job asks for something else.',
    );
  });

  it('leaves out a pick whose template is gone, such as one the app no longer has', () => {
    const text = templatesMarkdown(
      readAnswers({
        looks: [
          { layout: 'modern', for: 'startup' },
          { layout: 'classic', for: 'any' },
        ],
      }),
      TEMPLATES,
    );
    expect(text).not.toContain('modern');
    expect(text).toContain('| Classic | `classic` | any job |');
    expect(
      templatesMarkdown(readAnswers({ looks: [{ layout: 'banner', for: 'any' }] }), TEMPLATES),
    ).toContain('None picked yet.');
  });

  it('says when none are picked', () => {
    expect(templatesMarkdown(readAnswers({}), TEMPLATES)).toContain('None picked yet.');
  });
});
