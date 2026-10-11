import type { Bullet, Experience, Layout, Resume } from './schema.ts';

/** Text made safe for HTML. */
export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Text with **bold** and [[placeholders]] marked up. */
const md = (value: unknown) =>
  escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[(.+?)\]\]/g, '<mark class="ph">[$1]</mark>');

/** The heading over the systems cards, unless the resume names its own. */
export const DEFAULT_SYSTEMS_HEADING = 'Key Systems';

const dates = (e: Experience) => `${escapeHtml(e.start)} – ${escapeHtml(e.end)}`;
const section = (title: string, inner: string) =>
  `<section><h2>${escapeHtml(title)}</h2>${inner}</section>`;

function contact(r: Resume): string {
  const c = r.contact ?? {};
  const parts = [c.phone, c.email, c.linkedin, c.location, c.website].filter(Boolean);
  return `<div class="contact">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`;
}

function stats(r: Resume): string {
  if (!r.impact_stats?.length) return '';
  const cards = r.impact_stats
    .map((s) => `<div class="stat"><b>${escapeHtml(s.value)}</b><span>${md(s.label)}</span></div>`)
    .join('');
  return `<div class="stats" style="--n:${r.impact_stats.length}">${cards}</div>`;
}

function systems(r: Resume): string {
  if (!r.systems?.length) return '';
  const cards = r.systems
    .map((s) => `<div class="sys"><b>${escapeHtml(s.name)}</b><div>${md(s.text)}</div></div>`)
    .join('');
  return section(
    r.systems_heading || DEFAULT_SYSTEMS_HEADING,
    `<div class="systems">${cards}</div>`,
  );
}

function bullets(list: Bullet[]): string {
  const items = list.map(
    (b) => `<li>${b.lead ? `<span class="lead">${md(b.lead)}:</span> ` : ''}${md(b.text)}</li>`,
  );
  return `<ul class="b">${items.join('')}</ul>`;
}

function jobBody(e: Experience): string {
  const groups = (e.bullet_groups ?? []).map(
    (g) =>
      `${g.heading ? `<div class="grp">${escapeHtml(g.heading)}</div>` : ''}${bullets(g.bullets)}`,
  );
  return `${e.intro ? `<div class="intro">${md(e.intro)}</div>` : ''}${groups.join('')}`;
}

const company = (e: Experience) =>
  `${escapeHtml(e.company)}${e.company_note ? ` — ${escapeHtml(e.company_note)}` : ''}`;

function jobClassic(e: Experience): string {
  return `<div class="job">
    <div class="row"><div class="title">${escapeHtml(e.title)}</div><div class="when">${dates(e)}</div></div>
    <div class="row"><div class="co">${company(e)}</div><div class="co">${escapeHtml(e.location)}</div></div>
    ${jobBody(e)}</div>`;
}

function project(p: NonNullable<Resume['projects']>[number]): string {
  return `<div class="proj"><span class="pn">${md(p.name)}</span>${p.status ? ` <span class="ps">· ${md(p.status)}</span>` : ''}${p.url ? ` <span class="ps">· ${md(p.url)}</span>` : ''}<div>${md(p.text)}</div></div>`;
}

const projects = (r: Resume) =>
  r.projects?.length ? section('Independent Projects', r.projects.map(project).join('')) : '';

function skillLines(r: Resume, title: string): string {
  if (!r.skills?.length) return '';
  const lines = r.skills.map(
    (s) =>
      `<div class="s"><b>${escapeHtml(s.category)}:</b> ${s.items.map(escapeHtml).join(' · ')}</div>`,
  );
  return section(title, `<div class="skills">${lines.join('')}</div>`);
}

const extras = (r: Resume) =>
  (r.extra_sections ?? [])
    .map((x) =>
      section(x.heading, `<ul class="b">${x.items.map((i) => `<li>${md(i)}</li>`).join('')}</ul>`),
    )
    .join('');

const extrasInline = (r: Resume) =>
  (r.extra_sections ?? [])
    .map(
      (x) =>
        `<section><h2>${escapeHtml(x.heading)}</h2><ul class="b xtra">${x.items.map((i) => `<li>${md(i)}</li>`).join('')}</ul></section>`,
    )
    .join('');

const header = (r: Resume) => `
  <div class="name">${escapeHtml(r.name)}</div>
  <div class="headline">${escapeHtml(r.headline)}</div>
  ${r.tagline ? `<div class="tagline">${escapeHtml(r.tagline)}</div>` : ''}`;

interface Theme {
  css: string;
  body: (r: Resume) => string;
}

const THEMES: Record<Layout, Theme> = {
  executive: {
    css: `
      :root{--ink:#1d2433;--muted:#5b6474;--accent:#1f3a5f;--accent2:#b08d57;--rule:#d5dbe4;--tint:#f3f5f9}
      body{font-family:Calibri,"Segoe UI",sans-serif;font-size:10.1pt;line-height:1.32}
      .hdr{text-align:center;border-bottom:2px solid var(--accent);padding-bottom:8px;margin-bottom:10px}
      .name{font-family:Cambria,Georgia,serif;font-size:27pt;letter-spacing:3px;color:var(--accent);font-weight:700;text-transform:uppercase;line-height:1.05}
      .headline{font-size:12pt;color:var(--accent2);font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px}
      .tagline{font-size:10pt;color:var(--muted);margin-top:2px}
      .contact{font-size:9.6pt;color:var(--muted);margin-top:5px}
      .contact span+span:before{content:"  •  ";color:var(--accent2)}
      h2{font-family:Cambria,Georgia,serif;font-size:12.2pt;color:var(--accent);text-transform:uppercase;letter-spacing:1.6px;border-bottom:1px solid var(--rule);padding-bottom:2px;margin:13px 0 6px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px;margin:8px 0 2px}
      .stat{background:var(--tint);border-top:3px solid var(--accent);padding:6px 8px;text-align:center}
      .stat b{display:block;font-family:Cambria,Georgia,serif;font-size:16pt;color:var(--accent);line-height:1.1}
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
    `,
    body: (r) => `
      <div class="hdr">${header(r)}${contact(r)}</div>
      ${section('Executive Summary', `<div>${md(r.summary)}</div>`)}
      ${stats(r)}
      ${r.competencies?.length ? section('Core Competencies', `<ul class="comp">${r.competencies.map((c) => `<li>${md(c)}</li>`).join('')}</ul>`) : ''}
      ${systems(r)}
      ${section('Professional Experience', r.experience.map(jobClassic).join(''))}
      ${projects(r)}
      ${skillLines(r, 'Technical Skills')}
      ${extras(r)}
    `,
  },

  modern: {
    css: `
      :root{--ink:#16232b;--muted:#566771;--accent:#0f766e;--accent2:#134e4a;--rule:#d7e3e1;--tint:#eef6f5;--band:#12343b}
      body{font-family:"Segoe UI",Calibri,sans-serif;font-size:9.4pt;line-height:1.34}
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
    `,
    body: (r) => `
      <div class="band"><div>${header(r)}</div>${contact(r)}</div>
      <div class="grid">
        <aside class="side">
          ${r.impact_stats?.length ? `<div class="card"><h2>Impact</h2>${r.impact_stats.map((s) => `<div class="stat"><b>${escapeHtml(s.value)}</b><span>${md(s.label)}</span></div>`).join('')}</div>` : ''}
          ${r.competencies?.length ? `<div class="card"><h2>Expertise</h2><div class="chips">${r.competencies.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div></div>` : ''}
          ${r.skills?.length ? `<div class="card"><h2>Technology</h2>${r.skills.map((s) => `<div class="sk"><b>${escapeHtml(s.category)}</b><div>${s.items.map(escapeHtml).join(' · ')}</div></div>`).join('')}</div>` : ''}
        </aside>
        <main class="main">
          <section><h2>Profile</h2><div class="summary">${md(r.summary)}</div></section>
          <section><h2>Experience</h2>${r.experience.map(jobClassic).join('')}</section>
          ${r.projects?.length ? `<section><h2>Independent Projects</h2>${r.projects.map(project).join('')}</section>` : ''}
          ${extrasInline(r)}
        </main>
      </div>
    `,
  },

  timeline: {
    css: `
      :root{--ink:#1b1f24;--muted:#5f6670;--accent:#c2410c;--accent2:#1b1f24;--rule:#e2e4e8;--tint:#f6f6f7}
      body{font-family:"Segoe UI",Calibri,sans-serif;font-size:9.4pt;line-height:1.33}
      .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid var(--ink);padding-bottom:9px;margin-bottom:6px}
      .name{font-family:Bahnschrift,"Segoe UI",sans-serif;font-size:30pt;font-weight:700;letter-spacing:1px;text-transform:uppercase;line-height:1}
      .headline{font-size:12pt;color:var(--accent);font-weight:700;margin-top:4px}
      .tagline{font-size:9.4pt;color:var(--muted);margin-top:2px}
      .contact{font-size:9pt;color:var(--muted);text-align:right;line-height:1.55}.contact span{display:block}
      h2{font-family:Bahnschrift,"Segoe UI",sans-serif;font-size:13pt;text-transform:uppercase;letter-spacing:1.5px;margin:13px 0 6px;color:var(--ink)}
      h2:after{content:"";display:block;width:34px;height:3px;background:var(--accent);margin-top:2px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:0;border:1px solid var(--rule);border-radius:6px;margin-top:10px}
      .stat{padding:7px 9px;border-left:1px solid var(--rule)}.stat:first-child{border-left:0}
      .stat b{display:block;font-family:Bahnschrift,"Segoe UI",sans-serif;font-size:17pt;color:var(--accent);line-height:1.05}
      .stat span{font-size:8.4pt;color:var(--muted);line-height:1.22;display:block;margin-top:2px}
      .tl{display:grid;grid-template-columns:1.18in 1fr;column-gap:0}
      .tl .d{padding-right:14px;padding-top:1px}
      .tl .d b{display:block;font-size:8.8pt;white-space:nowrap}.tl .d span{font-size:9pt;color:var(--muted)}
      .tl .c{border-left:2px solid var(--rule);padding-left:16px;position:relative;padding-bottom:6px}
      .tl .c:before{content:"";position:absolute;left:-6px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--accent)}
      .title{font-weight:700;font-size:11.3pt}
      .co{font-weight:700;color:var(--muted);font-size:10pt}
      .intro{margin:3px 0}
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
    body: (r) => `
      <div class="hdr"><div>${header(r)}</div>${contact(r)}</div>
      ${stats(r)}
      ${section('Summary', `<div>${md(r.summary)}</div>`)}
      ${systems(r)}
      ${section(
        'Experience',
        r.experience
          .map(
            (e) => `
        <div class="tl"><div class="d"><b>${dates(e)}</b><span>${escapeHtml(e.location)}</span></div>
        <div class="c"><div class="title">${escapeHtml(e.title)}</div><div class="co">${company(e)}</div>${jobBody(e)}</div></div>`,
          )
          .join(''),
      )}
      ${projects(r)}
      ${skillLines(r, 'Technologies')}
      ${extras(r)}
    `,
  },
};

/**
 * A resume as a Letter-size HTML page in one of the layouts, ready to print to PDF. It needs no
 * fonts, images or scripts from anywhere else.
 */
export function renderHtml(resume: Resume, layout: Layout): string {
  const theme = THEMES[layout];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(resume.name)} — Resume</title>
<style>
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
