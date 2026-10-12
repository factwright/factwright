import { escapeHtml, md } from '../markup.ts';
import type { Resume } from '../schema.ts';
import {
  company,
  contact,
  dates,
  extraItems,
  header,
  jobBody,
  placed,
  project,
  section,
  skillRows,
  stats,
  studied,
  systemCards,
  type Theme,
} from './parts.ts';
import { sectionTitles } from './titles.ts';

/** Degrees on the same date rail as the jobs. */
const schools = (r: Resume) =>
  (r.education ?? [])
    .map(
      (e) => `
        <div class="tl"><div class="d"><b>${studied(e)}</b><span>${escapeHtml(e.location)}</span></div>
        <div class="c"><div class="title">${escapeHtml(e.degree)}</div><div class="co">${escapeHtml(e.school)}</div>${e.note ? `<div class="note">${md(e.note)}</div>` : ''}</div></div>`,
    )
    .join('');

/** A bold name, a date rail down the side, and one warm accent. */
export const timeline: Theme = {
  css: `
      :root{--ink:#1b1f24;--muted:#5f6670;--accent:#c2410c;--accent2:#1b1f24;--rule:#e2e4e8;--tint:#f6f6f7}
      body{font-family:Selawik,"Factwright Sans","Segoe UI",Calibri,sans-serif;font-size:9.4pt;line-height:1.33}
      .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid var(--ink);padding-bottom:9px;margin-bottom:6px}
      .name{font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:30pt;font-weight:700;letter-spacing:1px;text-transform:uppercase;line-height:1}
      .headline{font-size:12pt;color:var(--accent);font-weight:700;margin-top:4px}
      .tagline{font-size:9.4pt;color:var(--muted);margin-top:2px}
      .contact{font-size:9pt;color:var(--muted);text-align:right;line-height:1.55}.contact span{display:block}
      h2{font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:13pt;text-transform:uppercase;letter-spacing:1.5px;margin:13px 0 6px;color:var(--ink)}
      h2:after{content:"";display:block;width:34px;height:3px;background:var(--accent);margin-top:2px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:0;border:1px solid var(--rule);border-radius:6px;margin-top:10px}
      .stat{padding:7px 9px;border-left:1px solid var(--rule)}.stat:first-child{border-left:0}
      .stat b{display:block;font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:17pt;color:var(--accent);line-height:1.05}
      .stat span{font-size:8.4pt;color:var(--muted);line-height:1.22;display:block;margin-top:2px}
      .tl{display:grid;grid-template-columns:1.18in 1fr;column-gap:0}
      .tl .d{padding-right:14px;padding-top:1px}
      .tl .d b{display:block;font-size:8.8pt;white-space:nowrap}.tl .d span{font-size:9pt;color:var(--muted)}
      .tl .c{border-left:2px solid var(--rule);padding-left:16px;position:relative;padding-bottom:6px}
      .tl .c:before{content:"";position:absolute;left:-6px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--accent)}
      .title{font-weight:700;font-size:11.3pt}
      .co{font-weight:700;color:var(--muted);font-size:10pt}
      .intro{margin:3px 0}
      .note{font-size:9pt;color:var(--muted);margin-top:1px}
      .grp{font-weight:700;color:var(--accent);font-size:9.4pt;text-transform:uppercase;letter-spacing:.7px;margin:7px 0 1px}
      ul.b{margin:2px 0 0;padding-left:15px}
      ul.b li{margin:1.8px 0}
      ul.b li::marker{color:var(--accent)}
      .lead{font-weight:700}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .sys{background:var(--tint);border-left:3px solid var(--accent);padding:6px 9px;break-inside:avoid}
      .sys b{display:block;font-size:10pt}.sys div{font-size:9pt;color:#353b43;line-height:1.33}
      .tags{display:flex;flex-wrap:wrap;gap:5px 6px}
      .tag{border-bottom:2px solid var(--rule);padding:1px 6px;font-weight:600;font-size:9pt}
      .skills .s{margin:2px 0}.skills .s b{color:var(--accent)}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{color:var(--accent);font-size:9pt;font-weight:700}
    `,
  body: (r) => {
    const t = sectionTitles('timeline', r);
    const education = placed(r, r.education?.length ? section(t.education, schools(r)) : '');
    return `
      <div class="hdr"><div>${header(r)}</div>${contact(r)}</div>
      ${stats(r)}
      ${section(t.summary, `<div>${md(r.summary)}</div>`)}
      ${education.early}
      ${r.systems?.length ? section(t.systems, systemCards(r)) : ''}
      ${section(
        t.experience,
        r.experience
          .map(
            (e) => `
        <div class="tl"><div class="d"><b>${dates(e)}</b><span>${escapeHtml(e.location)}</span></div>
        <div class="c"><div class="title">${escapeHtml(e.title)}</div><div class="co">${company(e)}</div>${jobBody(e)}</div></div>`,
          )
          .join(''),
      )}
      ${r.projects?.length ? section(t.projects, r.projects.map(project).join('')) : ''}
      ${education.late}
      ${r.skills?.length ? section(t.skills, skillRows(r)) : ''}
      ${(r.extra_sections ?? []).map((x) => section(x.heading, extraItems(x.items))).join('')}
    `;
  },
};
