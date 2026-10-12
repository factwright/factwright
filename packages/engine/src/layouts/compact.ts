import { escapeHtml, md } from '../markup.ts';
import type { Education, Experience, Resume } from '../schema.ts';
import {
  company,
  contact,
  dates,
  extraItems,
  header,
  jobBody,
  placed,
  project,
  skillRows,
  stats,
  studied,
  systemCards,
  type Theme,
} from './parts.ts';
import { sectionTitles } from './titles.ts';

/** A section with its name in the side margin, beside its content. */
const gutter = (title: string, inner: string) =>
  `<section class="g"><h2>${escapeHtml(title)}</h2><div class="blk">${inner}</div></section>`;

/** Where and when, after the dates, on one line. */
const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

/** A job's title, company and dates on one line, to save space. */
const job = (e: Experience) => `<div class="job">
    <div class="row"><div><span class="title">${escapeHtml(e.title)}</span><span class="co"> · ${company(e)}</span></div><div class="when">${joined(dates(e), e.location && escapeHtml(e.location))}</div></div>
    ${jobBody(e)}</div>`;

const degree = (e: Education) => `<div class="edu">
    <div class="row"><div><span class="title">${escapeHtml(e.degree)}</span><span class="co"> · ${escapeHtml(e.school)}</span></div><div class="when">${joined(studied(e), e.location && escapeHtml(e.location))}</div></div>
    ${e.note ? `<div class="note">${md(e.note)}</div>` : ''}</div>`;

const schools = (r: Resume, title: string) =>
  r.education?.length ? gutter(title, r.education.map(degree).join('')) : '';

/** Section names in a side margin and tight spacing, to fit a lot on one page. */
export const compact: Theme = {
  css: `
      :root{--ink:#111827;--muted:#4b5563;--accent:#1d4ed8;--rule:#dfe3e8;--tint:#eff4ff}
      body{font-family:"Factwright Sans",Calibri,"Segoe UI",sans-serif;font-size:9.9pt;line-height:1.25}
      .hdr{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;border-bottom:2px solid var(--accent);padding-bottom:6px}
      .name{font-size:22pt;font-weight:700;line-height:1}
      .headline{font-size:11pt;color:var(--accent);font-weight:700;margin-top:3px}
      .tagline{font-size:9.4pt;color:var(--muted);margin-top:1px}
      .contact{font-size:9pt;color:var(--muted);text-align:right;line-height:1.4}.contact span{display:block}
      section.g{display:grid;grid-template-columns:1.02in 1fr;column-gap:12px;padding:7px 0;border-bottom:1px solid var(--rule)}
      section.g:last-child{border-bottom:0}
      section.g>h2{margin:0;font-size:8.6pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent);line-height:1.45}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:10px}
      .stat b{display:block;font-size:13pt;line-height:1.05;color:var(--accent)}
      .stat span{display:block;font-size:8.6pt;color:var(--muted);line-height:1.2;margin-top:1px}
      .comp{columns:3;column-gap:14px;margin:0;padding-left:13px}
      .comp li{break-inside:avoid;margin:0}
      .job{margin-bottom:6px}.job:last-child,.edu:last-child{margin-bottom:0}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
      .title{font-weight:700;font-size:10.4pt}
      .co{color:var(--muted)}
      .when{font-size:9pt;color:var(--muted);white-space:nowrap}
      .intro{margin:1px 0}
      .grp{font-weight:700;margin:4px 0 0}
      ul.b{margin:1px 0 0;padding-left:13px}
      ul.b li{margin:1px 0}
      ul.b li::marker{color:var(--accent)}
      .lead{font-weight:700}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:5px 8px}
      .sys{background:var(--tint);border-radius:3px;padding:4px 7px;break-inside:avoid}
      .sys b{display:block;font-size:9.6pt}.sys div{font-size:9.2pt;line-height:1.24}
      .skills .s{margin:1px 0}
      .proj{margin:0 0 4px}.proj:last-child{margin:0}.proj .pn{font-weight:700}.proj .ps{color:var(--muted);font-size:9pt}
      .edu{margin-bottom:4px}.edu .note{font-size:9.2pt;color:var(--muted)}
    `,
  body: (r) => {
    const t = sectionTitles('compact', r);
    const education = placed(r, schools(r, t.education));
    return `
      <div class="hdr"><div>${header(r)}</div>${contact(r)}</div>
      ${gutter(t.summary, `<div class="sum">${md(r.summary)}</div>`)}
      ${r.impact_stats?.length ? gutter('Highlights', stats(r)) : ''}
      ${education.early}
      ${r.competencies?.length ? gutter(t.competencies, extraItems(r.competencies, 'comp')) : ''}
      ${r.systems?.length ? gutter(t.systems, systemCards(r)) : ''}
      ${gutter(t.experience, r.experience.map(job).join(''))}
      ${r.projects?.length ? gutter(t.projects, r.projects.map(project).join('')) : ''}
      ${education.late}
      ${r.skills?.length ? gutter(t.skills, skillRows(r)) : ''}
      ${(r.extra_sections ?? []).map((x) => gutter(x.heading, extraItems(x.items))).join('')}
    `;
  },
};
