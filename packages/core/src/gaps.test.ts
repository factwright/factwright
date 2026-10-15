import { describe, expect, it } from 'vitest';
import { factBlocks } from './facts.ts';
import { doesntHave, hasGap, newGapsFile, withGap, withoutGap } from './gaps.ts';

const GAPS = [
  '# Gaps',
  '',
  'What Alex doesn’t have, and what to ask.',
  '',
  "## Doesn't have (don't claim, don't ask again)",
  '| Topic | Their answer | Date |',
  '|---|---|---|',
  '| Rust in production | No | 2026-10-12 |',
  '| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |',
  '',
  '## Needs confirmation',
  '- Was the cost work measured?',
  '',
  '## Open questions',
  '| Topic | Why |',
  '|---|---|',
  '| GraphQL | Wanted by most postings |',
  '',
].join('\n');

const NO = { topic: 'GraphQL', answer: 'No (asked “Have you used GraphQL?”)', date: '2026-10-14' };

describe('doesntHave', () => {
  it('reads each row of the Doesn’t have table, however its heading goes on', () => {
    expect(doesntHave(GAPS)).toEqual({
      title: "Doesn't have (don't claim, don't ask again)",
      rows: [
        {
          index: 0,
          line: '| Rust in production | No | 2026-10-12 |',
          topic: 'Rust in production',
          answer: 'No',
          date: '2026-10-12',
        },
        {
          index: 1,
          line: '| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |',
          topic: 'Kafka | Pulsar',
          answer: 'Only a course (2019)',
          date: '2026-10-12',
        },
      ],
    });
  });

  it('reads a list, a curly apostrophe, and a file without the section', () => {
    const list = ['# Gaps', '', '## Doesn’t have', '- **Rust:** No (2026-10-01)', '- Go', ''];
    expect(doesntHave(list.join('\n'))?.rows).toEqual([
      {
        index: 0,
        line: '- **Rust:** No (2026-10-01)',
        topic: 'Rust',
        answer: 'No (2026-10-01)',
        date: '2026-10-01',
      },
      { index: 1, line: '- Go', topic: 'Go', answer: '', date: null },
    ]);
    expect(doesntHave('# Gaps\n\n## Open questions\n- One\n')).toBeNull();
  });

  it('knows a topic it has, whatever its case', () => {
    expect(hasGap(GAPS, '  rust IN production ')).toBe(true);
    expect(hasGap(GAPS, 'GraphQL')).toBe(false);
  });
});

describe('withGap', () => {
  it('adds a row after the table’s last, leaving everything else as written', () => {
    const next = withGap(GAPS, NO);
    expect(next).toBe(
      GAPS.replace(
        '| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |\n',
        '| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |\n| GraphQL | No (asked “Have you used GraphQL?”) | 2026-10-14 |\n',
      ),
    );
    expect(doesntHave(next)?.rows.at(-1)).toMatchObject({ topic: 'GraphQL', date: '2026-10-14' });
  });

  it('keeps a row to one line, with its pipes escaped', () => {
    const next = withGap(GAPS, {
      topic: 'A | B\n## Heading',
      answer: 'No\r\n|x|',
      date: '2026-10-14',
    });
    expect(next).toContain('| A \\| B ## Heading | No \\|x\\| | 2026-10-14 |\n');
    expect(factBlocks(next, { claims: false }).map((block) => block.title)).toEqual(
      factBlocks(GAPS, { claims: false }).map((block) => block.title),
    );
    expect(doesntHave(next)?.rows.at(-1)).toMatchObject({
      topic: 'A | B ## Heading',
      answer: 'No |x|',
    });
  });

  it('keeps Windows line endings, and a last line without one', () => {
    const windows = GAPS.replace(/\n/g, '\r\n');
    expect(withGap(windows, NO)).toBe(withGap(GAPS, NO).replace(/\n/g, '\r\n'));
    const ending =
      "# Gaps\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| Rust | No | 2026-10-12 |";
    expect(withGap(ending, NO)).toBe(
      `${ending}\n| GraphQL | No (asked “Have you used GraphQL?”) | 2026-10-14 |\n`,
    );
  });

  it('adds to a list, after the last item’s own lines', () => {
    const list =
      "# Gaps\n\n## Doesn't have\n- **Rust:** No\n  - not even a side project\n\n## Open questions\n";
    expect(withGap(list, NO)).toBe(
      "# Gaps\n\n## Doesn't have\n- **Rust:** No\n  - not even a side project\n- **GraphQL:** No (asked “Have you used GraphQL?”) (2026-10-14)\n\n## Open questions\n",
    );
  });

  it('starts a table in an empty section, and a section where there’s none', () => {
    expect(withGap("# Gaps\n\n## Doesn't have\n\n## Open questions\n", NO)).toBe(
      "# Gaps\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| GraphQL | No (asked “Have you used GraphQL?”) | 2026-10-14 |\n\n## Open questions\n",
    );
    expect(withGap('# Gaps\n\nNotes.\n\n## Open questions\n- One\n', NO)).toBe(
      "# Gaps\n\nNotes.\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| GraphQL | No (asked “Have you used GraphQL?”) | 2026-10-14 |\n\n## Open questions\n- One\n",
    );
    expect(withGap('# Gaps\n', NO)).toBe(
      "# Gaps\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| GraphQL | No (asked “Have you used GraphQL?”) | 2026-10-14 |\n",
    );
  });

  it('never takes a table in a code block for the section’s', () => {
    const fenced = "# Gaps\n\n```\n## Doesn't have\n| a | b |\n|---|---|\n```\n";
    expect(doesntHave(fenced)).toBeNull();
    expect(doesntHave(withGap(fenced, NO))?.rows.map((row) => row.topic)).toEqual(['GraphQL']);
  });
});

describe('newGapsFile', () => {
  it('starts a gaps file with the bank’s sections and the one row', () => {
    const file = newGapsFile(NO);
    expect(doesntHave(file)?.rows.map((row) => row.topic)).toEqual(['GraphQL']);
    expect(factBlocks(file, { claims: false }).map((block) => block.title)).toEqual([
      'Gaps',
      "Doesn't have",
      'Needs confirmation',
      'Open questions',
    ]);
  });
});

describe('withoutGap', () => {
  it('takes back a row as the window saw it, even once another moved it', () => {
    const [, kafka] = doesntHave(GAPS)?.rows ?? [];
    if (!kafka) throw new Error('No row');
    expect(withoutGap(GAPS, kafka)).toBe(
      GAPS.replace('| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |\n', ''),
    );
    // Claude added a row before it meanwhile: it's still found by what it says.
    const moved = GAPS.replace(
      '| Rust in production',
      '| Go | No | 2026-10-13 |\n| Rust in production',
    );
    expect(withoutGap(moved, kafka)).toBe(
      moved.replace('| Kafka \\| Pulsar | Only a course (2019) | 2026-10-12 |\n', ''),
    );
  });

  it('leaves a row that changed, or one of two that read the same', () => {
    const [rust] = doesntHave(GAPS)?.rows ?? [];
    if (!rust) throw new Error('No row');
    expect(withoutGap(GAPS.replace('| No |', '| Not really |'), rust)).toBeNull();
    const twice = GAPS.replace('| Kafka', '| Rust in production | No | 2026-10-12 |\n| Kafka');
    expect(withoutGap(twice, { index: 5, line: rust.line })).toBeNull();
    expect(withoutGap('# Gaps\n', rust)).toBeNull();
  });
});
