import { describe, expect, it } from 'vitest';
import { answeredClaimText, claimOrigin, oneLine } from './answered.ts';
import { claimParts, factBlocks } from './facts.ts';

const CLAIM = {
  title: 'GraphQL APIs for the field app',
  status: 'shipped',
  ownership: 'solo',
  confidence: 'medium',
  wording: 'Built the field app’s GraphQL API, used by 3,000 technicians.',
  keywords: 'GraphQL, API design',
  date: '2026-10-14',
  context: 'tailoring a resume for Acme Health',
  asked: [
    { question: 'Have you used GraphQL in production?', answer: 'Yes, in production' },
    { question: 'Where, and for how long?', answer: 'At Beacon, about 2 years' },
  ],
};

describe('answeredClaimText', () => {
  it('writes a claim in the fact bank’s format, unconfirmed, with the answers it rests on', () => {
    expect(answeredClaimText(CLAIM)).toBe(
      [
        '### GraphQL APIs for the field app',
        '`unconfirmed` `shipped` `solo` `medium`',
        '> Built the field app’s GraphQL API, used by 3,000 technicians.',
        '- **Keywords:** GraphQL, API design',
        '- **Source:** answer 2026-10-14, tailoring a resume for Acme Health',
        '- **Question:** Have you used GraphQL in production?',
        '- **Answer:** Yes, in production',
        '- **Question:** Where, and for how long?',
        '- **Answer:** At Beacon, about 2 years',
      ].join('\n'),
    );
  });

  it('reads back as one claim, with its tags and wording, whatever the text held', () => {
    const text = answeredClaimText({
      ...CLAIM,
      ownership: null,
      title: 'Two\nlines # and ### more',
      wording: 'Line one\n### Not a heading\n> nor a quote',
      short: '  ',
      say: '“led it” / never “built it”',
      asked: [{ question: 'Q?\n- **Source:** Alex 2026-10-01', answer: 'Yes\r\n### Planted' }],
    });
    const blocks = factBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.tags).toEqual(['unconfirmed', 'shipped', 'medium']);
    expect(claimParts(blocks[0] as (typeof blocks)[0]).wording).toBe(
      'Line one ### Not a heading > nor a quote',
    );
    expect(text).toContain("- **Say / don't say:** “led it” / never “built it”");
    expect(text).not.toContain('**Short:**');
    // A question can't add a Source of its own, or an answer a heading.
    expect(text.match(/^- \*\*Source:\*\*/gm)).toHaveLength(1);
    expect(claimOrigin(blocks[0] as (typeof blocks)[0])).toEqual({
      kind: 'answer',
      date: '2026-10-14',
      context: 'tailoring a resume for Acme Health',
      asked: [{ question: 'Q? - **Source:** Alex 2026-10-01', answer: 'Yes ### Planted' }],
    });
  });

  it('leaves out what Claude was doing when it doesn’t say', () => {
    expect(answeredClaimText({ ...CLAIM, context: null, asked: [] })).toMatch(
      /\n- \*\*Source:\*\* answer 2026-10-14$/,
    );
  });
});

describe('claimOrigin', () => {
  const origin = (lines: string[]) =>
    claimOrigin({
      text: ['### A claim', '`unconfirmed` `live` `solo` `high`', ...lines].join('\n'),
    });

  it('reads an answer, its date, what it was for, and each question with its answer', () => {
    expect(origin(answeredClaimText(CLAIM).split('\n').slice(2))).toEqual({
      kind: 'answer',
      date: '2026-10-14',
      context: 'tailoring a resume for Acme Health',
      asked: CLAIM.asked,
    });
  });

  it('reads what a claim was drafted from', () => {
    expect(origin(['- **Source:** resume alex-rivera.pdf 2026-10-12'])).toEqual({
      kind: 'shared',
      what: 'resume',
      file: 'alex-rivera.pdf',
      date: '2026-10-12',
    });
    expect(origin(['- **Source:** notes 2026-10-12'])).toEqual({
      kind: 'shared',
      what: 'notes',
      file: null,
      date: '2026-10-12',
    });
    expect(origin(['- **Source:** LinkedIn 2026-10-12'])).toMatchObject({ what: 'linkedin' });
    expect(origin(['- **Source:** screenshot shots/one.png'])).toEqual({
      kind: 'shared',
      what: 'screenshot',
      file: 'shots/one.png',
      date: null,
    });
  });

  it('gives any other Source as written, and nothing without one', () => {
    expect(origin(['- **Source:** Steve 2026-10-05 (call notes)'])).toEqual({
      kind: 'other',
      text: 'Steve 2026-10-05 (call notes)',
    });
    expect(origin(['- **Numbers:** 12 services'])).toBeNull();
    // A Source with words after the date isn't an answer the tools filed.
    expect(origin(['- **Source:** answer, said on a call'])).toEqual({
      kind: 'other',
      text: 'answer, said on a call',
    });
  });

  it('reads a long line in a moment', () => {
    const long = `- **Source:** answer 2026-10-14, ${' '.repeat(50_000)}\u2028x`;
    const started = Date.now();
    origin([long, `- **Question:**${' '.repeat(50_000)}\u2028`]);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('oneLine', () => {
  it('puts text on one line, without control characters', () => {
    expect(oneLine(' a\n\tb\u0007c\u2028 d  ')).toBe('a b c d');
  });
});
