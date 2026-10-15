import { dateRanges } from './dates.ts';
import type { Line, ReadFile } from './read.ts';

/** Where a PDF line sits on its page, in points from the bottom left. */
interface Box {
  left: number;
  right: number;
  /** Its baseline. */
  y: number;
  size: number;
}

/** A line's box, from the pieces of it with words. */
function boxOf(line: Line): Box | null {
  const runs = line.runs.filter((run) => run.text.trim());
  if (runs.length === 0) return null;
  return {
    left: Math.min(...runs.map((run) => run.x)),
    right: Math.max(...runs.map((run) => run.x + run.width)),
    y: runs[0]?.y ?? 0,
    size: Math.max(...runs.map((run) => run.size)),
  };
}

/** Whether two boxes are on the same row of the page, one beside the other. */
const besideEachOther = (a: Box, b: Box) =>
  Math.abs(a.y - b.y) < Math.min(a.size, b.size) * 0.6 &&
  (a.right + 4 < b.left || b.right + 4 < a.left);

/** Whether two boxes share some of the page's width, so one is above the other. */
const overlapAcross = (a: Box, b: Box) => a.left < b.right && b.left < a.right;

/**
 * Lines that repeat at the top or bottom of each page, such as a name and page number, and lines
 * printed in the page's margin. Parsers read them where they fall: in the middle of the text.
 */
export function marginLines(file: ReadFile): number[] {
  const found = new Set<number>();
  const edge = 0.4 * 72;
  const keyed = new Map<string, { index: number; page: number; y: number }[]>();
  for (const [index, line] of file.lines.entries()) {
    const box = boxOf(line);
    const page = file.pages[line.page - 1];
    if (!box || !page) continue;
    if (box.y > page.height - edge || box.y < edge) found.add(index);
    if (box.y > page.height * 0.85 || box.y < page.height * 0.15) {
      const key = line.text.toLowerCase().replace(/\d+/g, '#');
      keyed.set(key, [...(keyed.get(key) ?? []), { index, page: line.page, y: box.y }]);
    }
  }
  for (const same of keyed.values()) {
    const pages = new Set(same.map((each) => each.page));
    const first = same[0];
    if (pages.size >= 2 && first && same.every((each) => Math.abs(each.y - first.y) < 4)) {
      for (const each of same) found.add(each.index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** A jump in the reading order: after `from`, the parser goes back up the page to `to`. */
export interface Jump {
  from: number;
  to: number;
}

/**
 * Where the reading order jumps back up a page within the same column, as when part of a page is
 * drawn last. A jump to the top of the next column, as two columns are read, is in order.
 */
export function orderJumps(file: ReadFile): Jump[] {
  const jumps: Jump[] = [];
  for (let index = 1; index < file.lines.length; index++) {
    const before = file.lines[index - 1] as Line;
    const line = file.lines[index] as Line;
    const page = file.pages[line.page - 1];
    const [a, b] = [boxOf(before), boxOf(line)];
    if (!a || !b || !page || before.page !== line.page) continue;
    if (b.y - a.y > page.height * 0.25 && overlapAcross(a, b))
      jumps.push({ from: index - 1, to: index });
  }
  return jumps;
}

/** A stretch of a page with text side by side in two or more columns. */
export interface Columns {
  page: number;
  /** Its top and bottom, in points from the page's bottom. */
  top: number;
  bottom: number;
  /** Its lines. */
  lines: number[];
}

/**
 * Stretches of each page where lines sit side by side, in columns. Small ones, such as a row of
 * numbers or a grid of cards inside one section, read card by card. Big ones are found by
 * `wideColumns`.
 */
export function columnStretches(file: ReadFile): Columns[] {
  const stretches: Columns[] = [];
  for (const [p] of file.pages.entries()) {
    const number = p + 1;
    const boxes = file.lines
      .map((line, index) => ({ index, box: line.page === number ? boxOf(line) : null }))
      .filter((each): each is { index: number; box: Box } => each.box !== null);
    const paired = boxes.filter(({ index, box }) =>
      boxes.some((other) => other.index !== index && besideEachOther(box, other.box)),
    );
    paired.sort((a, b) => b.box.y - a.box.y);
    let current: Columns | null = null;
    for (const { index, box } of paired) {
      if (current && current.bottom - box.y < box.size * 3) {
        current.bottom = Math.min(current.bottom, box.y);
        current.lines.push(index);
      } else {
        current = { page: number, top: box.y + box.size, bottom: box.y, lines: [index] };
        stretches.push(current);
      }
    }
  }
  return stretches;
}

/**
 * Columns that run down much of a page or hold a section's heading, as a sidebar does. Most
 * systems read one column, then the other, as the X-ray shows them; some read straight across
 * the page and mix the two.
 */
export function wideColumns(file: ReadFile, headingLines: ReadonlySet<number>): Columns[] {
  return columnStretches(file).filter((stretch) => {
    const page = file.pages[stretch.page - 1];
    const tall = page ? stretch.top - stretch.bottom > page.height * 0.35 : false;
    return tall || stretch.lines.some((index) => headingLines.has(index));
  });
}

/**
 * Lines that are only a span of dates, read far from the line they sit beside, as when a
 * template draws the dates down one side after everything else. A parser then can't tell which
 * job each one belongs to.
 */
export function strayDates(file: ReadFile): number[] {
  const stray: number[] = [];
  for (const [index, line] of file.lines.entries()) {
    const span = dateRanges(line.text)[0];
    const box = boxOf(line);
    if (!span || !box || span.text.length < line.text.length * 0.7) continue;
    const beside = file.lines.flatMap((other, at) => {
      const otherBox = other.page === line.page && at !== index ? boxOf(other) : null;
      return otherBox && besideEachOther(box, otherBox) ? [at] : [];
    });
    if (beside.length > 0 && beside.every((at) => Math.abs(at - index) > 2)) stray.push(index);
  }
  return stray;
}
