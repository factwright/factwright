import { describe, expect, it } from 'vitest';
import { outputName, pdfPageCount } from './files.ts';
import { fitReport, isRunt, measurableHtml } from './fit.ts';
import { sampleResume } from './sample.ts';

describe('fitReport', () => {
  it('marks runts: text that wraps with little on its last line', () => {
    expect(isRunt({ lines: 2, last: 12, text: '' })).toBe(true);
    expect(isRunt({ lines: 1, last: 12, text: '' })).toBe(false);
    expect(isRunt({ lines: 3, last: 30, text: '' })).toBe(false);
    expect(
      fitReport([
        { lines: 1, last: 64, text: 'Staff Platform Engineer' },
        { lines: 2, last: 8, text: 'Cut deploy time by ~40% across twelve services and' },
      ]),
    ).toBe(
      [
        '  1L  64% | Staff Platform Engineer',
        '! 2L   8% | Cut deploy time by ~40% across twelve services and',
        '',
        '1 runt line(s) marked "!": the last line is under 30% full. Trim or extend those.',
      ].join('\n'),
    );
    expect(fitReport([])).toBe('\nNo runt lines.');
  });

  it('lays the page out as wide as the printed text', () => {
    expect(measurableHtml('<html><head><title>x</title></head><body></body></html>')).toBe(
      '<html><head><title>x</title><style>@media screen{body{width:7.4in}}</style></head><body></body></html>',
    );
  });
});

describe('outputName', () => {
  const today = new Date(2026, 9, 11);

  it('uses the resume’s own name, or the person’s name and the date', () => {
    expect(
      outputName({ ...sampleResume(), output_name: 'AlexRiveraResume10112026_Acme' }, today),
    ).toBe('AlexRiveraResume10112026_Acme');
    expect(outputName(sampleResume(), today)).toBe('AlexRiveraResume10112026');
  });

  it('keeps out characters a file name can’t hold', () => {
    expect(outputName({ ...sampleResume(), output_name: 'Alex/Rivera:Resume?' }, today)).toBe(
      'Alex-Rivera-Resume-',
    );
  });
});

describe('pdfPageCount', () => {
  it('reads the page tree’s count', () => {
    expect(pdfPageCount('<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> << /Count 1 >>')).toBe(2);
    expect(pdfPageCount('not a pdf')).toBeNull();
  });
});
