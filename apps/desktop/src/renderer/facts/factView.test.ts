import { describe, expect, it } from 'vitest';
import { type FactBank, factFile } from '../../shared/facts.ts';
import {
  bankCounts,
  blockMatches,
  detailsWithoutOrigin,
  findFacts,
  originOf,
  picksOf,
  tagInfo,
  tagsWith,
  unverifiedFacts,
} from './factView.ts';

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
  it('counts the claims in files of facts, and the ones to verify', () => {
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
    expect(blockMatches(reminders, 'unverified')).toBe(true);
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
    const found = findFacts(facts, { query: 'shipped' });
    expect(
      found.map(({ file, blocks }) => [file.path, blocks.map((block) => block.title)]),
    ).toEqual([['facts/acme.md', ['Reminder texts']]]);
  });

  it('keeps the block being changed, whatever it says now', () => {
    const found = findFacts(facts, {
      query: 'reminder',
      keep: (path, block) => path === 'facts/beta.md' && block.title === 'Kept',
    });
    expect(found.flatMap(({ blocks }) => blocks.map((block) => block.title))).toEqual([
      'Reminder texts',
      'Kept',
    ]);
  });
});

describe('unverifiedFacts', () => {
  it('lists the facts to verify, the newest answers first, then the rest as the files go', () => {
    const answer = (title: string, date: string) =>
      `### ${title}\n\`unconfirmed\` \`live\`\n> Did it.\n- **Source:** answer ${date}, tailoring a resume for Fernway\n`;
    const list = unverifiedFacts(
      bank({
        'facts/acme.md': `${ACME}\n${answer('Older answer', '2026-10-12')}\n${answer('Later that day', '2026-10-12')}`,
        'facts/beta.md': `# Beta\n\n${answer('Newer answer', '2026-10-14')}\n### Drafted\n\`unconfirmed\` \`built\`\n> From notes.\n- **Source:** notes 2026-10-01\n`,
        'facts/gaps.md': '### Not a claim here\n`unconfirmed`\n',
      }),
    );
    expect(list.map(({ file, block }) => [file.path, block.title])).toEqual([
      ['facts/beta.md', 'Newer answer'],
      ['facts/acme.md', 'Later that day'],
      ['facts/acme.md', 'Older answer'],
      ['facts/acme.md', 'Reminder texts'],
      ['facts/beta.md', 'Drafted'],
    ]);
  });
});

describe('originOf', () => {
  const blockWith = (lines: string[]) =>
    factFile(
      'facts/acme.md',
      ['### A fact', '`unconfirmed` `live`', '> Did it.', ...lines].join('\n'),
    ).blocks[0] as Parameters<typeof originOf>[0];

  it('says where a fact came from, and the questions it rests on', () => {
    expect(
      originOf(
        blockWith([
          '- **Source:** answer 2026-10-14, tailoring a resume for Fernway',
          '- **Question:** Have you used GraphQL?',
          '- **Answer:** Yes, in production',
        ]),
        '2026-10-15',
      ),
    ).toEqual({
      text: 'Your answer while tailoring a resume for Fernway, Oct 14',
      asked: [{ question: 'Have you used GraphQL?', answer: 'Yes, in production' }],
    });
    expect(originOf(blockWith(['- **Source:** answer 2025-12-01']), '2026-10-15')?.text).toBe(
      'Your answer, Dec 1, 2025',
    );
    expect(
      originOf(blockWith(['- **Source:** resume alex-rivera.pdf 2026-10-12']), '2026-10-15')?.text,
    ).toBe('From your resume alex-rivera.pdf, Oct 12');
    expect(originOf(blockWith(['- **Source:** LinkedIn 2026-10-12']), '2026-10-15')?.text).toBe(
      'From your LinkedIn, Oct 12',
    );
    expect(originOf(blockWith(['- **Source:** profile 2026-10-14']), '2026-10-15')?.text).toBe(
      'From Beyond work in your Profile, Oct 14',
    );
    expect(originOf(blockWith(['- **Source:** a call with Sam']), '2026-10-15')?.text).toBe(
      'Source: a call with Sam',
    );
    expect(originOf(blockWith([]), '2026-10-15')).toBeNull();
  });

  it('leaves where it came from out of its other details', () => {
    expect(
      detailsWithoutOrigin(
        '- **Numbers:** 30 partners\n- **Source:** answer 2026-10-14\n- **Question:** Q?\n- **Answer:** A',
      ),
    ).toBe('- **Numbers:** 30 partners');
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
