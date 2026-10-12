import { md } from '../markup.ts';
import {
  block,
  contact,
  extraItems,
  header,
  jobClassic,
  placed,
  project,
  school,
  skillRows,
  stats,
  systemCards,
  type Theme,
} from './parts.ts';
import { sectionTitles } from './titles.ts';

/** Serif type with a deep red accent, and plenty of air. */
export const elegant: Theme = {
  css: `
      :root{--ink:#221d1f;--muted:#5f575b;--accent:#7b2d3b;--accent2:#5c2230;--rule:#e4d8db;--tint:#f8f2f3}
      body{font-family:Caladea,Cambria,Georgia,serif;font-size:10.3pt;line-height:1.33}
      .hdr{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;padding-bottom:9px;border-bottom:1.5px solid var(--accent)}
      .name{font-size:28pt;font-weight:700;color:var(--accent);line-height:1.02}
      .headline{font-size:12pt;font-style:italic;margin-top:4px}
      .tagline{font-size:9.8pt;color:var(--muted);margin-top:2px}
      .contact{font-family:"Factwright Sans",Calibri,sans-serif;font-size:9pt;color:var(--muted);text-align:right;line-height:1.5}
      .contact span{display:block}
      h2{display:flex;align-items:center;gap:10px;font-size:12pt;font-weight:700;color:var(--accent);margin:13px 0 5px}
      h2:after{content:"";flex:1;height:1px;background:var(--rule)}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:12px;margin-top:11px}
      .stat{border-left:2px solid var(--accent);padding:1px 0 1px 9px}
      .stat b{display:block;font-size:16pt;color:var(--accent);line-height:1.05}
      .stat span{display:block;font-size:8.8pt;color:var(--muted);line-height:1.22;margin-top:2px}
      .comp{columns:3;column-gap:18px;margin:0;padding-left:15px}
      .comp li{break-inside:avoid;margin:1px 0}.comp li::marker{color:var(--accent)}
      .job{margin-bottom:9px}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
      .title{font-weight:700;font-size:11pt}
      .when{font-family:"Factwright Sans",Calibri,sans-serif;font-size:9pt;color:var(--muted);letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}
      .co{font-style:italic;color:var(--accent2)}
      .intro{margin:2px 0}
      .grp{font-family:"Factwright Sans",Calibri,sans-serif;font-weight:700;color:var(--accent2);font-size:8.8pt;letter-spacing:1px;text-transform:uppercase;margin:6px 0 1px}
      ul.b{margin:2px 0 0;padding-left:16px}
      ul.b li{margin:1.7px 0}
      ul.b li::marker{color:var(--accent)}
      .lead{font-weight:700}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px}
      .sys{background:var(--tint);border-radius:4px;padding:6px 9px;break-inside:avoid}
      .sys b{display:block;color:var(--accent2)}.sys div{font-size:9.7pt;line-height:1.3}
      .skills .s{margin:2px 0}.skills .s b{color:var(--accent2)}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{font-style:italic;color:var(--accent2)}
      .edu{margin-bottom:6px}.edu .note{font-size:9.7pt;color:var(--muted)}
    `,
  body: (r) => {
    const t = sectionTitles('elegant', r);
    const education = placed(
      r,
      r.education?.length ? block(t.education, r.education.map(school).join('')) : '',
    );
    return `
      <div class="hdr"><div>${header(r)}</div>${contact(r)}</div>
      ${stats(r)}
      ${block(t.summary, `<div class="sum">${md(r.summary)}</div>`)}
      ${education.early}
      ${r.competencies?.length ? block(t.competencies, extraItems(r.competencies, 'comp')) : ''}
      ${r.systems?.length ? block(t.systems, systemCards(r)) : ''}
      ${block(t.experience, r.experience.map(jobClassic).join(''))}
      ${r.projects?.length ? block(t.projects, r.projects.map(project).join('')) : ''}
      ${education.late}
      ${r.skills?.length ? block(t.skills, skillRows(r)) : ''}
      ${(r.extra_sections ?? []).map((x) => block(x.heading, extraItems(x.items))).join('')}
    `;
  },
};
