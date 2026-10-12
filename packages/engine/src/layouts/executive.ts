import { md } from '../markup.ts';
import type { Resume } from '../schema.ts';
import {
  block,
  contact,
  extraItems,
  header,
  jobClassic,
  placed,
  project,
  school,
  section,
  skillRows,
  stats,
  systemCards,
  type Theme,
} from './parts.ts';
import { sectionTitles } from './titles.ts';

const competencies = (r: Resume, title: string) =>
  r.competencies?.length
    ? section(
        title,
        `<ul class="comp">${r.competencies.map((c) => `<li>${md(c)}</li>`).join('')}</ul>`,
      )
    : '';

/** A centered header, serif headings and a strengths block, in navy and gold. */
export const executive: Theme = {
  css: `
      :root{--ink:#1d2433;--muted:#5b6474;--accent:#1f3a5f;--accent2:#b08d57;--rule:#d5dbe4;--tint:#f3f5f9}
      body{font-family:"Factwright Sans",Calibri,"Segoe UI",sans-serif;font-size:10.1pt;line-height:1.32}
      .hdr{text-align:center;border-bottom:2px solid var(--accent);padding-bottom:8px;margin-bottom:10px}
      .name{font-family:Caladea,Cambria,Georgia,serif;font-size:27pt;letter-spacing:3px;color:var(--accent);font-weight:700;text-transform:uppercase;line-height:1.05}
      .headline{font-size:12pt;color:var(--accent2);font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px}
      .tagline{font-size:10pt;color:var(--muted);margin-top:2px}
      .contact{font-size:9.6pt;color:var(--muted);margin-top:5px}
      .contact span+span:before{content:"  •  ";color:var(--accent2)}
      h2{font-family:Caladea,Cambria,Georgia,serif;font-size:12.2pt;color:var(--accent);text-transform:uppercase;letter-spacing:1.6px;border-bottom:1px solid var(--rule);padding-bottom:2px;margin:13px 0 6px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px;margin:8px 0 2px}
      .stat{background:var(--tint);border-top:3px solid var(--accent);padding:6px 8px;text-align:center}
      .stat b{display:block;font-family:Caladea,Cambria,Georgia,serif;font-size:16pt;color:var(--accent);line-height:1.1}
      .stat span{font-size:8.6pt;color:var(--muted);line-height:1.2;display:block;margin-top:2px}
      .comp{columns:3;column-gap:18px;font-size:9.8pt;margin:0;padding-left:14px}
      .comp li{break-inside:avoid;margin:1px 0}
      .job{margin-bottom:9px}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
      .title{font-weight:700;font-size:11.2pt;color:var(--ink)}
      .when{font-weight:700;color:var(--accent);white-space:nowrap;font-size:10pt}
      .co{font-style:italic;color:var(--muted)}
      .intro{margin:3px 0 3px}
      .grp{font-weight:700;color:var(--accent);font-size:9.8pt;text-transform:uppercase;letter-spacing:.8px;margin:6px 0 1px}
      ul.b{margin:2px 0 0;padding-left:16px}
      ul.b li{margin:1.8px 0}
      ul.b li::marker{color:var(--accent2)}
      .lead{font-weight:700;color:var(--ink)}
      .skills .s{margin:2px 0}.skills .s b{color:var(--accent)}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{color:var(--accent2);font-size:9.4pt;font-weight:700}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
      .sys{background:var(--tint);border-left:3px solid var(--accent);padding:5px 9px;break-inside:avoid}
      .sys b{display:block;font-size:10pt;color:var(--accent)}.sys div{font-size:9.4pt;line-height:1.3}
      .edu{margin-bottom:6px}.edu .note{font-size:9.4pt;color:var(--muted)}
    `,
  body: (r) => {
    const t = sectionTitles('executive', r);
    const education = placed(
      r,
      r.education?.length ? block(t.education, r.education.map(school).join('')) : '',
    );
    return `
      <div class="hdr">${header(r)}${contact(r)}</div>
      ${section(t.summary, `<div>${md(r.summary)}</div>`)}
      ${stats(r)}
      ${education.early}
      ${competencies(r, t.competencies)}
      ${r.systems?.length ? section(t.systems, systemCards(r)) : ''}
      ${section(t.experience, r.experience.map(jobClassic).join(''))}
      ${r.projects?.length ? section(t.projects, r.projects.map(project).join('')) : ''}
      ${education.late}
      ${r.skills?.length ? section(t.skills, skillRows(r)) : ''}
      ${(r.extra_sections ?? []).map((x) => section(x.heading, extraItems(x.items))).join('')}
    `;
  },
};
