/** One piece of a resume's text, as laid out on the page. */
export interface FitRow {
  /** How many lines it takes. */
  lines: number;
  /** How full its last line is, from 0 to 100. */
  last: number;
  /** Its text, cut short. */
  text: string;
}

/** A last line less full than this wastes a line on a word or two. */
export const RUNT_PERCENT = 30;

/**
 * Makes the page as wide as the printed page's text, so lines break on screen where they will on
 * paper: Letter, less 0.55-inch margins.
 */
export function measurableHtml(html: string): string {
  return html.replace('</head>', '<style>@media screen{body{width:7.4in}}</style></head>');
}

/**
 * Measures each piece of text on a page made by measurableHtml, run in the page: how many lines
 * it takes, and how full its last line is. It evaluates to a list of FitRows.
 */
export const MEASURE_SCRIPT = `(() => {
  const selector = '.headline,.tagline,.stat span,.sys div,.intro,section>div:not(.systems):not(.stats):not(.skills):not(.tl),li,.proj div,.skills .s';
  return [...document.querySelectorAll(selector)].map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 14;
    const lines = Math.round(box.height / lineHeight);
    const rows = {};
    for (const rect of range.getClientRects()) {
      const top = Math.round(rect.top / 3);
      rows[top] = (rows[top] || 0) + rect.width;
    }
    const tops = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const last = tops.length ? rows[tops[tops.length - 1]] / box.width : 0;
    return { lines, last: Math.round(last * 100), text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 90) };
  });
})()`;

/** A runt: text that wraps, with only a word or two on its last line. */
export const isRunt = (row: FitRow) => row.lines > 1 && row.last < RUNT_PERCENT;

/** The fit report: each piece of text's lines and last-line fill, with runts marked "!". */
export function fitReport(rows: readonly FitRow[]): string {
  const lines = rows.map(
    (row) =>
      `${isRunt(row) ? '!' : ' '} ${row.lines}L ${String(row.last).padStart(3)}% | ${row.text}`,
  );
  const runts = rows.filter(isRunt).length;
  return [
    ...lines,
    '',
    runts
      ? `${runts} runt line(s) marked "!": the last line is under ${RUNT_PERCENT}% full. Trim or extend those.`
      : 'No runt lines.',
  ].join('\n');
}
