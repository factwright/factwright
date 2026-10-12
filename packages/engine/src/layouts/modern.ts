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
  section,
  systemCards,
  type Theme,
} from './parts.ts';
import { sectionTitles } from './titles.ts';

/** Two columns under a dark header, with the numbers and skills in the side column. */
export const modern: Theme = {
  css: `
      :root{--ink:#16232b;--muted:#566771;--accent:#0f766e;--accent2:#134e4a;--rule:#d7e3e1;--tint:#eef6f5;--band:#12343b}
      body{font-family:Selawik,"Factwright Sans","Segoe UI",Calibri,sans-serif;font-size:9.4pt;line-height:1.34}
      .band{background:var(--band);color:#fff;border-radius:10px;padding:14px 18px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
      .name{font-size:25pt;font-weight:700;letter-spacing:.5px;line-height:1}
      .headline{font-size:11.2pt;color:#8be3d6;font-weight:600;margin-top:5px}
      .tagline{font-size:9.2pt;color:#cfe7e3;margin-top:3px}
      .contact{font-size:8.9pt;color:#e3f1ef;text-align:right;line-height:1.55}
      .contact span{display:block}
      .grid{display:grid;grid-template-columns:2.15in 1fr;gap:16px}
      .side h2,.main h2{font-size:10.6pt;text-transform:uppercase;letter-spacing:1.4px;color:var(--accent2);margin:0 0 6px;padding-bottom:3px;border-bottom:2px solid var(--accent)}
      .card{background:var(--tint);border-radius:8px;padding:9px 10px;margin-bottom:10px}
      .stat{margin:0 0 7px}.stat b{display:block;font-size:15pt;color:var(--accent);line-height:1.05}
      .stat span{font-size:8.5pt;color:var(--muted);line-height:1.25;display:block}
      .chips{display:flex;flex-wrap:wrap;gap:4px}
      .chip{background:#fff;border:1px solid #bfd9d5;border-radius:10px;padding:1px 7px;font-size:8.3pt;color:var(--accent2)}
      .sk{margin-bottom:6px}.sk b{display:block;font-size:8.6pt;color:var(--accent2);text-transform:uppercase;letter-spacing:.6px}
      .sk div{font-size:8.7pt;color:var(--ink);line-height:1.35}
      .main section{margin-bottom:11px}
      .summary{font-size:10.1pt}
      .job{margin-bottom:10px}
      .title{font-weight:700;font-size:11pt}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
      .when{font-size:9pt;color:var(--accent);font-weight:700;white-space:nowrap}
      .co{color:var(--muted);font-weight:600;font-size:9.6pt}
      .intro{margin:3px 0}
      .grp{font-weight:700;color:var(--accent);font-size:9.3pt;margin:6px 0 1px;letter-spacing:.3px}
      ul.b{margin:2px 0 0;padding-left:14px}
      ul.b li{margin:1.8px 0}
      ul.b li::marker{color:var(--accent)}
      .lead{font-weight:700;color:var(--accent2)}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{color:var(--accent);font-size:8.8pt;font-weight:700}
      .xtra li{margin:2px 0}
      .edu{margin-bottom:7px}.edu .note{font-size:8.9pt;color:var(--muted)}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px}
      .sys{background:var(--tint);border-radius:6px;padding:6px 9px;break-inside:avoid}
      .sys b{display:block;color:var(--accent2)}.sys div{font-size:8.9pt;line-height:1.3}
    `,
  body: (r) => {
    const t = sectionTitles('modern', r);
    const education = placed(
      r,
      r.education?.length ? block(t.education, r.education.map(school).join('')) : '',
    );
    return `
      <div class="band"><div>${header(r)}</div>${contact(r)}</div>
      <div class="grid">
        <aside class="side">
          ${r.impact_stats?.length ? `<div class="card"><h2>Impact</h2>${r.impact_stats.map((s) => `<div class="stat"><b>${escapeHtml(s.value)}</b><span>${md(s.label)}</span></div>`).join('')}</div>` : ''}
          ${r.competencies?.length ? `<div class="card"><h2>${escapeHtml(t.competencies)}</h2><div class="chips">${r.competencies.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div></div>` : ''}
          ${r.skills?.length ? `<div class="card"><h2>${escapeHtml(t.skills)}</h2>${r.skills.map((s) => `<div class="sk"><b>${escapeHtml(s.category)}</b><div>${s.items.map(escapeHtml).join(' · ')}</div></div>`).join('')}</div>` : ''}
        </aside>
        <main class="main">
          <section><h2>${escapeHtml(t.summary)}</h2><div class="summary">${md(r.summary)}</div></section>
          ${education.early}
          ${r.systems?.length ? section(t.systems, systemCards(r)) : ''}
          <section><h2>${escapeHtml(t.experience)}</h2>${r.experience.map(jobClassic).join('')}</section>
          ${r.projects?.length ? `<section><h2>${escapeHtml(t.projects)}</h2>${r.projects.map(project).join('')}</section>` : ''}
          ${education.late}
          ${(r.extra_sections ?? []).map((x) => section(x.heading, extraItems(x.items, 'b xtra'))).join('')}
        </main>
      </div>
    `;
  },
};
