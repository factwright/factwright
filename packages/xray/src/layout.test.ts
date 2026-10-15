import { describe, expect, it } from 'vitest';
import { columnStretches, marginLines, orderJumps, strayDates, wideColumns } from './layout.ts';
import { fileOf, pdfLine } from './testing.ts';

/** Lines one under another, down a page, starting at a height. */
const column = (texts: string[], x: number, top: number, step = 14, page = 1) =>
  texts.map((text, i) => pdfLine(text, x, top - i * step, { page }));

describe('orderJumps', () => {
  it('finds text read after the text below it, in the same column', () => {
    const lines = [
      ...column(['Summary', 'Text that comes first'], 40, 400),
      pdfLine('JORDAN AVERY', 40, 760),
    ];
    expect(orderJumps(fileOf(lines))).toEqual([{ from: 1, to: 2 }]);
  });

  it('reads going on to the top of the next column as in order', () => {
    const left = column(['Contact', 'Skills', 'Education'], 40, 700, 100);
    const right = column(['Experience', 'A job'], 260, 700);
    expect(orderJumps(fileOf([...left, ...right]))).toEqual([]);
  });

  it('lets small steps back up the page be, as in a grid of cards', () => {
    const lines = [
      ...column(['Card one', 'its text'], 40, 500),
      ...column(['Card two', 'its text'], 300, 500),
    ];
    expect(orderJumps(fileOf(lines))).toEqual([]);
  });
});

describe('columns', () => {
  it('finds lines side by side, and tells a grid of cards from a sidebar', () => {
    const cards = fileOf([
      ...column(['Card one', 'text one'], 40, 500),
      ...column(['Card two', 'text two'], 300, 500),
    ]);
    expect(columnStretches(cards)).toHaveLength(1);
    expect(wideColumns(cards, new Set())).toEqual([]);

    const tall = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const sidebar = fileOf([...column(tall, 40, 740, 16), ...column(tall, 220, 740, 16)]);
    expect(wideColumns(sidebar, new Set())).toHaveLength(1);
  });

  it('takes columns holding a heading for a sidebar, however short', () => {
    const lines = [
      ...column(['SKILLS', 'SQL'], 40, 500),
      ...column(['A job', 'its text'], 260, 500),
    ];
    expect(wideColumns(fileOf(lines), new Set([0]))).toHaveLength(1);
  });
});

describe('strayDates', () => {
  it('finds dates read far from the line they sit beside', () => {
    const lines = [
      pdfLine('Senior Engineer', 40, 700),
      ...column(['Bullet one.', 'Bullet two.', 'Bullet three.'], 50, 686),
      pdfLine('2019 – 2021', 500, 700),
    ];
    expect(strayDates(fileOf(lines))).toEqual([4]);
  });

  it('lets dates read beside their title be', () => {
    const lines = [
      pdfLine('Senior Engineer', 40, 700),
      pdfLine('2019 – 2021', 500, 700),
      pdfLine('A bullet.', 50, 686),
    ];
    expect(strayDates(fileOf(lines))).toEqual([]);
  });
});

describe('marginLines', () => {
  it('finds text repeated at the foot of each page, and text in the page’s margin', () => {
    const lines = [
      pdfLine('Jordan Avery · Page 1', 250, 40, { page: 1 }),
      pdfLine('Body text', 40, 400, { page: 1 }),
      pdfLine('Jordan Avery · Page 2', 250, 40, { page: 2 }),
      pdfLine('Printed in the margin', 40, 10, { page: 2 }),
    ];
    expect(marginLines(fileOf(lines))).toEqual([0, 2, 3]);
  });

  it('lets a one-page footer be', () => {
    expect(marginLines(fileOf([pdfLine('References on request', 40, 60)]))).toEqual([]);
  });
});
