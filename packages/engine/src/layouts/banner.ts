import { escapeHtml, md } from '../markup.ts';
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

/** A blue banner across the top, with bold bars over each section below. */
export const banner: Theme = {
  css: `
      :root{--ink:#172033;--muted:#55607a;--accent:#1e3a8a;--accent2:#2563eb;--band:#1e3a8a;--tint:#eef2ff;--rule:#d9e1f2}
      body{font-family:Selawik,"Factwright Sans","Segoe UI",Calibri,sans-serif;font-size:9.5pt;line-height:1.34}
      .band{background:var(--band);color:#fff;padding:15px 20px 12px;border-radius:3px}
      .name{font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:27pt;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;line-height:1}
      .headline{font-size:11.6pt;font-weight:600;color:#c7d7fe;margin-top:5px}
      .tagline{font-size:9.4pt;color:#dbe4ff;margin-top:2px}
      .contact{display:flex;flex-wrap:wrap;gap:3px 16px;font-size:9pt;color:#eef2ff;margin-top:9px;padding-top:7px;border-top:1px solid rgba(255,255,255,.3)}
      h2{font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:11.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1.3px;color:var(--accent);background:var(--tint);border-left:4px solid var(--accent2);padding:2px 9px;margin:11px 0 5px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px;margin-top:10px}
      .stat{border:1px solid var(--rule);border-radius:6px;padding:6px 9px}
      .stat b{display:block;font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;font-size:16pt;color:var(--accent2);line-height:1.05}
      .stat span{display:block;font-size:8.5pt;color:var(--muted);line-height:1.22;margin-top:2px}
      .chips{display:flex;flex-wrap:wrap;gap:4px 5px}
      .chip{background:var(--tint);border-radius:10px;padding:1px 9px;font-size:8.8pt;color:var(--accent)}
      .job{margin-bottom:8px}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
      .title{font-weight:700;font-size:10.8pt}
      .when{font-size:9pt;font-weight:700;color:var(--accent2);white-space:nowrap}
      .co{color:var(--muted);font-weight:600}
      .intro{margin:2px 0}
      .grp{font-weight:700;color:var(--accent);margin:6px 0 1px}
      ul.b{margin:2px 0 0;padding-left:15px}
      ul.b li{margin:1.8px 0}
      ul.b li::marker{color:var(--accent2)}
      .lead{font-weight:700;color:var(--accent)}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
      .sys{border:1px solid var(--rule);border-left:3px solid var(--accent2);border-radius:4px;padding:5px 9px;break-inside:avoid}
      .sys b{display:block;color:var(--accent)}.sys div{font-size:9.1pt;line-height:1.3}
      .skills .s{margin:2px 0}.skills .s b{color:var(--accent)}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{color:var(--accent2);font-size:9pt;font-weight:700}
      .edu{margin-bottom:6px}.edu .note{color:var(--muted)}
    `,
  body: (r) => {
    const t = sectionTitles('banner', r);
    const education = placed(
      r,
      r.education?.length ? block(t.education, r.education.map(school).join('')) : '',
    );
    const chips = (r.competencies ?? [])
      .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
      .join('');
    return `
      <div class="band">${header(r)}${contact(r)}</div>
      ${stats(r)}
      ${block(t.summary, `<div class="sum">${md(r.summary)}</div>`)}
      ${education.early}
      ${chips ? block(t.competencies, `<div class="chips">${chips}</div>`) : ''}
      ${r.systems?.length ? block(t.systems, systemCards(r)) : ''}
      ${block(t.experience, r.experience.map(jobClassic).join(''))}
      ${r.projects?.length ? block(t.projects, r.projects.map(project).join('')) : ''}
      ${education.late}
      ${r.skills?.length ? block(t.skills, skillRows(r)) : ''}
      ${(r.extra_sections ?? []).map((x) => block(x.heading, extraItems(x.items))).join('')}
    `;
  },
};
