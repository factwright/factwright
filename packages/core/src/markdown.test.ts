import { describe, expect, it } from 'vitest';
import { markdownItems, markdownSections, markdownTable } from './markdown.ts';

describe('markdownTable', () => {
  it('reads rows keyed by lowercase column heading', () => {
    const text = [
      '# Fit checks',
      '',
      '| Date | Company | Note |',
      '|---|---|---|',
      '| 2026-10-07 | Acme Robotics | Pays well \\| remote |',
      '| 2026-10-08 | Northwind Labs |',
      '',
      'Notes after the table.',
    ].join('\n');
    expect(markdownTable(text)).toEqual([
      { date: '2026-10-07', company: 'Acme Robotics', note: 'Pays well | remote' },
      { date: '2026-10-08', company: 'Northwind Labs', note: '' },
    ]);
  });

  it.each([null, '', 'No table here.', '| Only | a heading |'])(
    'returns no rows for %j',
    (text) => {
      expect(markdownTable(text)).toEqual([]);
    },
  );
});

describe('markdownSections', () => {
  it('keys sections by heading, without a trailing date', () => {
    const sections = markdownSections(
      'Intro\n## Why it fits\n- One\n## Company sentiment (2026-10-09)\n- Two',
    );
    expect([...sections.keys()]).toEqual(['', 'why it fits', 'company sentiment']);
    expect(sections.get('company sentiment')).toEqual({
      title: 'Company sentiment (2026-10-09)',
      lines: ['- Two'],
    });
    expect(sections.get('')?.lines).toEqual(['Intro']);
  });

  it('joins repeated headings into one section', () => {
    const sections = markdownSections('## Gaps\n- One\n## Gaps\n- Two');
    expect(sections.get('gaps')?.lines).toEqual(['- One', '- Two']);
  });
});

describe('markdownItems', () => {
  it('reads items with their indented sub-items', () => {
    const items = markdownItems([
      '- Work 33/40: platform services',
      '  - ✓ Build tooling',
      '  - ~ On-call rotations',
      '1. Numbered item',
    ]);
    expect(items).toEqual([
      { text: 'Work 33/40: platform services', sub: ['✓ Build tooling', '~ On-call rotations'] },
      { text: 'Numbered item', sub: [] },
    ]);
  });

  it('joins wrapped lines to the item they continue', () => {
    const items = markdownItems([
      '- A long item',
      'that wraps',
      '  - A sub-item',
      '    that wraps',
    ]);
    expect(items).toEqual([{ text: 'A long item that wraps', sub: ['A sub-item that wraps'] }]);
  });

  it('counts a stray paragraph as an item, and stops at blank lines and headings', () => {
    const items = markdownItems(['Thin data on this company.', '', '# Heading', 'Another line']);
    expect(items).toEqual([
      { text: 'Thin data on this company.', sub: [] },
      { text: 'Another line', sub: [] },
    ]);
  });
});
