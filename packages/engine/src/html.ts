import { type FontUrls, fontFaceCss } from './fonts.ts';
import { THEMES } from './layouts/index.ts';
import { escapeHtml } from './markup.ts';
import type { Layout, Resume } from './schema.ts';

export { DEFAULT_PROJECTS_HEADING, DEFAULT_SYSTEMS_HEADING } from './layouts/titles.ts';
export { escapeHtml };

/**
 * A resume as a Letter-size HTML page in one of the layouts, ready to print to PDF. Given the
 * font files, it carries them, so it looks the same on any computer. It needs nothing from
 * anywhere else: no fonts, images or scripts.
 */
export function renderHtml(resume: Resume, layout: Layout, fonts: FontUrls = {}): string {
  const theme = THEMES[layout];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(resume.name)} — Resume</title>
<style>
  ${fontFaceCss(layout, fonts)}
  @page{size:Letter;margin:0.5in 0.55in 0.5in}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  section,.job,.proj,.stat{break-inside:auto}
  ul.b li,.proj,.sys,.card .stat{break-inside:avoid}
  h2{break-after:avoid}
  .grp{break-after:avoid;break-inside:avoid}
  section:has(.proj),section:has(.skills){break-inside:avoid}
  .contact span{white-space:nowrap}
  mark.ph{background:#fff1a8;color:#5a4a00;padding:0 3px;border-radius:2px}
  .row,.title{break-after:avoid}
  /* Timeline dots position .c, so position its siblings too, which keeps the PDF's text in reading order. */
  .hdr,.stats,section,.tl .d{position:relative}
  ${theme.css}
</style></head><body>${theme.body(resume)}</body></html>`;
}
