import { describe, expect, it } from 'vitest';
import { readAnswers } from './about.ts';
import { suggestedFor, suggestLooks, templatesMarkdown } from './looks.ts';

describe('suggestLooks', () => {
  it('suggests a template for each kind of company the user is aiming at', () => {
    const suggestions = suggestLooks({
      companies: ['startup', 'established'],
      fields: ['software'],
      levels: ['senior'],
    });
    expect(suggestions.map(({ layout, for: kind }) => [kind, layout])).toEqual([
      ['startup', 'timeline'],
      ['established', 'executive'],
    ]);
    expect(suggestions[0]?.why).toBe('Suits startups and your field');
  });

  it('suits formal fields and public employers with the classic look', () => {
    const [suggestion] = suggestLooks({
      companies: ['public'],
      fields: ['legal'],
      levels: ['mid'],
    });
    expect(suggestion?.layout).toBe('classic');
    expect(suggestLooks({ companies: [], fields: ['design'], levels: ['senior'] })).toEqual([
      { layout: 'modern', for: 'any', why: 'Suits your field' },
    ]);
  });

  it('gives each kind of company its own template, even when one suits them all best', () => {
    const suggestions = suggestLooks({
      companies: ['startup', 'established'],
      fields: ['software'],
      levels: ['entry'],
    });
    expect(suggestions.map(({ layout, for: kind }) => [kind, layout])).toEqual([
      ['startup', 'compact'],
      ['established', 'executive'],
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
    expect(suggestedFor('compact', suggestions)).toEqual(['startup']);
    expect(suggestedFor('banner', suggestions)).toEqual([]);
  });
});

describe('templatesMarkdown', () => {
  it('lists the picks for the resume skills, with length and files', () => {
    const text = templatesMarkdown(
      readAnswers({
        looks: [
          { layout: 'timeline', for: 'startup' },
          { layout: 'executive', for: 'established' },
        ],
        levels: ['entry'],
        format: 'both',
      }),
    );
    expect(text).toContain('| Timeline | `timeline` | Startups (the startup style) |');
    expect(text).toContain(
      '| Executive | `executive` | Established companies (the big-company style) |',
    );
    expect(text).toContain('- **Length:** one page, for their level.');
    expect(text).toContain(
      '- **Files:** Both (PDF and Word), unless a job asks for something else.',
    );
  });

  it('says when none are picked', () => {
    expect(templatesMarkdown(readAnswers({}))).toContain('None picked yet.');
  });
});
