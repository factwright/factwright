import { describe, expect, it } from 'vitest';
import { NO_ANSWERS, readAnswers } from './about.ts';
import { criteriaMarkdown } from './criteria.ts';
import { untouched } from './stamp.ts';

const ANSWERS = readAnswers({
  roles: ['Product Designer', 'UX Designer'],
  fields: ['design'],
  levels: ['senior', 'lead'],
  workplaces: ['remote', 'hybrid'],
  remoteFrom: 'anywhere in the US',
  places: ['Denver', 'Boulder'],
  relocate: 'maybe',
  companies: ['startup', 'public'],
  industries: ['Healthcare', 'Climate'],
  avoid: ['Gambling'],
  employment: ['full-time', 'contract'],
  minPay: '$120,000',
  targetPay: '$150,000',
  payFilter: true,
  authorization: 'US citizen',
  start: 'two weeks’ notice',
  mustHaves: 'A mission I believe in',
  dealBreakers: 'On-call weeks\nlong commutes',
  quiet: true,
});

describe('criteriaMarkdown', () => {
  it('writes what the user wants as filters, preferences and pay', () => {
    const text = criteriaMarkdown(ANSWERS);
    for (const line of [
      '# Job search criteria',
      '- **Where:** Remote from anywhere in the US; hybrid in Denver or Boulder. Open to relocating for the right job.',
      '- **Level:** Senior or Lead or principal.',
      '- **Kind of work:** Design and UX. Roles such as Product Designer or UX Designer, and close matches.',
      '- **Employment:** Full-time or Contract.',
      '- **Pay:** At least $120,000 base, when the posting says.',
      '- **Not in:** gambling.',
      '- **Work authorization:** US citizen',
      '- **Deal-breakers:** On-call weeks / long commutes',
      '- **Companies:** Startups or Government, nonprofits and schools.',
      '- **Industries:** Healthcare or Climate.',
      '- **Target:** $150,000 base.',
      '- **Start:** two weeks’ notice',
      '| Role | 25 | The level and shape fit what the user wants: Senior or Lead or principal roles: Product Designer or UX Designer |',
      '**Tiers:** Strong ≥ 75 · Good 62–74 · Worth a look 50–61. Below 50 goes to long shots.',
    ]) {
      expect(text).toContain(line);
    }
    expect(text).toMatch(/\*\*Quiet search:\*\* they’re employed/);
  });

  it('keeps the lowest pay out of the filters unless the user asked', () => {
    const text = criteriaMarkdown({ ...ANSWERS, payFilter: false });
    expect(text).not.toContain('- **Pay:**');
    expect(text).toContain("- **Lowest they'd take:** $120,000 base.");
  });

  it('still makes a whole file with nothing told', () => {
    const text = criteriaMarkdown(NO_ANSWERS);
    expect(text).toContain('## Filters (must pass)\n- **Real:**');
    expect(text).toContain('- None given yet.');
  });

  it('marks the file as the app’s, until someone changes it', () => {
    const text = criteriaMarkdown(ANSWERS);
    expect(untouched(text)).toBe(true);
    expect(untouched(text.replace('Denver', 'Austin'))).toBe(false);
    expect(untouched('# My own criteria\n')).toBe(false);
    expect(untouched(null)).toBe(true);
  });
});
