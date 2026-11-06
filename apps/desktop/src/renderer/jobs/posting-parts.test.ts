import { describe, expect, it } from 'vitest';
import { postingParts, WHOLE_POSTING } from './posting-parts.ts';

/** The parts a text has, by their ids. */
const has = (text: string) =>
  postingParts(text)
    .filter((part) => part.found)
    .map((part) => part.id);

describe('the parts of a pasted posting', () => {
  it('finds none in nothing, and all of them in a whole posting', () => {
    expect(has('')).toEqual([]);
    const posting = [
      'Senior Program Manager, Platform',
      'About the role: you will run the roadmap with engineering, and report to the VP.',
      'Qualifications: 7+ years of program management. A bachelor’s degree, or the same experience.',
      'The base pay range is $160,000–$190,000 a year, with benefits and a bonus.',
      'Hybrid: three days a week in our Chicago office.',
      'More about the team. '.repeat(60),
    ].join('\n\n');
    expect(posting.length).toBeGreaterThanOrEqual(WHOLE_POSTING);
    expect(has(posting)).toEqual(['whole', 'work', 'asks', 'pay', 'place']);
  });

  it('knows each part by the ways postings head it', () => {
    expect(has('Responsibilities\n- Lead the team')).toEqual(['work']);
    expect(has('What you’ll do: lead the team')).toEqual(['work']);
    expect(has("What you'll do: lead the team")).toEqual(['work']);
    expect(has('Requirements\n- Python')).toEqual(['asks']);
    expect(has('What we’re looking for: someone kind')).toEqual(['asks']);
    expect(has('Must-have: SQL')).toEqual(['asks']);
    expect(has('£45,000 a year')).toEqual(['pay']);
    expect(has('Compensation: competitive')).toEqual(['pay']);
    expect(has('Remote (US)')).toEqual(['place']);
    expect(has('On-site in Austin')).toEqual(['place']);
  });

  it('takes a short text as part of a posting, however much it has', () => {
    const closing =
      'Workiva lets employees work from an office or remotely from any location in their country of employment.';
    expect(has(closing)).toEqual(['place']);
    expect(postingParts(closing)[0]?.found).toBe(false);
  });
});
