import { type FontUrls, fontFaceCss } from './fonts.ts';
import type { CoverLetter } from './letter.ts';
import { escapeHtml } from './markup.ts';
import type { Resume } from './schema.ts';
import { letterStyles, renderBody, renderLetterBody } from './template/render.ts';
import type { Template } from './templates.ts';

export { DEFAULT_PROJECTS_HEADING, DEFAULT_SYSTEMS_HEADING } from './template/render.ts';
export { escapeHtml };

/**
 * What the page may load, should a template ever carry more than it should: no scripts at all,
 * and only its own styles, and fonts and pictures from data: URLs.
 */
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * A Letter-size HTML page, ready to print to PDF, with its fonts carried as data: URLs, so it
 * looks the same on any computer. It needs nothing from anywhere else, and runs no scripts: no
 * fonts, images or scripts load from anywhere.
 */
function page(title: string, fonts: string, css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><title>${escapeHtml(title)}</title>
<style>
  ${fonts}
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
  /* A template's marks can position an element, such as the dots on a date rail, so its siblings are positioned too, which keeps the PDF's text in reading order. */
  .hdr,.stats,section,.tl .d{position:relative}
  ${css}
</style></head><body>${body}</body></html>`;
}

/** A resume as a Letter-size page in a template, ready to print to PDF. */
export function renderHtml(resume: Resume, template: Template, fonts: FontUrls = {}): string {
  return page(
    `${resume.name} — Resume`,
    fontFaceCss(template.fonts, fonts),
    template.css,
    renderBody(template, resume),
  );
}

/**
 * A cover letter as a Letter-size page in a template, ready to print to PDF: in the template's
 * own letter layout, under the same header as the resume, or else plainly in its fonts and colors.
 */
export function renderLetterHtml(
  letter: CoverLetter,
  template: Template,
  fonts: FontUrls = {},
): string {
  return page(
    `${letter.name} — Cover Letter`,
    fontFaceCss(template.fonts, fonts),
    letterStyles(template),
    renderLetterBody(template, letter),
  );
}
