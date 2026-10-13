import { describe, expect, it } from 'vitest';
import { type FactBank, factFile } from '../../shared/facts.ts';
import { bankCounts, blockMatches, findFacts, picksOf, tagInfo, tagsWith } from './factView.ts';

const ACME = [
  '# Acme Health',
  'Staff engineer at a clinic software company.',
  '',
  '### Scheduling platform',
  '`live` `led-and-built` `high`',
  '> Built a scheduling platform used by 40 clinics.',
  '- **Keywords:** Kubernetes, scheduling',
  '',
  '### Reminder texts',
  '`unconfirmed` `shipped` `solo` `medium`',
  '> Shipped appointment reminder texts.',
  '',
].join('\n');

const bank = (files: Record<string, string>): FactBank => ({
  files: Object.entries(files).map(([path, text]) => factFile(path, text)),
  skipped: [],
  firstName: 'Alex',
});

describe('bankCounts', () => {
  it('counts the claims in files of facts, and the ones to confirm', () => {
    expect(
      bankCounts(
        bank({
          'facts/acme.md': ACME,
          'facts/gaps.md': '### Looks like one\n`live`\n',
          'facts/profile.md': '# Profile\n',
        }),
      ),
    ).toEqual({ claims: 2, unconfirmed: 1, files: 2 });
  });
});

describe('blockMatches', () => {
  const [opening, platform, reminders] = factFile('facts/acme.md', ACME).blocks;
  if (!opening || !platform || !reminders) throw new Error('missing blocks');

  it('finds every word searched for, in any order and any case', () => {
    expect(blockMatches(platform, 'clinics KUBERNETES')).toBe(true);
    expect(blockMatches(platform, 'clinics rust')).toBe(false);
    expect(blockMatches(platform, '  ')).toBe(true);
  });

  it('finds a tag by what it reads as', () => {
    expect(blockMatches(platform, 'led and built')).toBe(true);
    expect(blockMatches(reminders, 'not confirmed')).toBe(true);
  });

  it('finds a file’s opening by what it says, not by the file’s name', () => {
    expect(blockMatches(opening, 'acme')).toBe(false);
    expect(blockMatches(opening, 'clinic software')).toBe(true);
  });
});

describe('findFacts', () => {
  const facts = bank({
    'facts/acme.md': ACME,
    'facts/beta.md': '# Beta\n\n### Kept\n`live`\n> Kept it.\n',
  });

  it('finds blocks across files, file by file', () => {
    const found = findFacts(facts, { query: 'shipped', toConfirm: false });
    expect(
      found.map(({ file, blocks }) => [file.path, blocks.map((block) => block.title)]),
    ).toEqual([['facts/acme.md', ['Reminder texts']]]);
  });

  it('shows only the claims still to confirm', () => {
    const found = findFacts(facts, { query: '', toConfirm: true });
    expect(found.flatMap(({ blocks }) => blocks.map((block) => block.title))).toEqual([
      'Reminder texts',
    ]);
  });

  it('keeps the block being changed, whatever it says now', () => {
    const found = findFacts(facts, {
      query: 'reminder',
      toConfirm: false,
      keep: (path, block) => path === 'facts/beta.md' && block.title === 'Kept',
    });
    expect(found.flatMap(({ blocks }) => blocks.map((block) => block.title))).toEqual([
      'Reminder texts',
      'Kept',
    ]);
  });
});

describe('picksOf and tagsWith', () => {
  it('reads the status, ownership and confidence a claim has', () => {
    expect(picksOf(['unconfirmed', 'shipped', 'solo', 'medium'])).toEqual({
      status: 'shipped',
      ownership: 'solo',
      confidence: 'medium',
    });
    expect(picksOf(['as-of-2026'])).toEqual({ status: '', ownership: '', confidence: '' });
  });

  it('keeps a claim’s tags as they were when its picks don’t change', () => {
    const tags = ['high', 'solo', 'live', 'as-of-2026'];
    expect(tagsWith(tags, picksOf(tags))).toEqual(tags);
  });

  it('puts new picks in the format’s order, keeping `unconfirmed` first and the user’s own tags', () => {
    expect(
      tagsWith(['unconfirmed', 'built', 'solo', 'high', 'as-of-2026'], {
        status: 'live',
        ownership: 'led-team',
        confidence: '',
      }),
    ).toEqual(['unconfirmed', 'live', 'led-team', 'as-of-2026']);
  });
});

describe('tagInfo', () => {
  it('reads a known tag in words, and the user’s own as written', () => {
    expect(tagInfo('led-and-built').label).toBe('Led and built');
    expect(tagInfo('as-of-2026')).toEqual({ label: 'as-of-2026', meaning: '', tone: 'gray' });
  });
});
