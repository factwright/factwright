import type { Template } from '../templates.ts';
import { BODY, LETTER, letterCss, PARTS } from './markup.ts';

/** Quiet and airy: lots of white space, gray headings and no color. */
export const minimal: Template = {
  id: 'minimal',
  name: 'Minimal',
  look: 'Quiet and airy: lots of white space, gray headings and no color.',
  fonts: [
    'selawik-regular.woff2',
    'selawik-semibold.woff2',
    'selawik-bold.woff2',
    'factwright-sans-regular.woff2',
    'factwright-sans-bold.woff2',
  ],
  titles: {
    summary: 'Summary',
    competencies: 'Strengths',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
  },
  word: {
    head: 'Segoe UI',
    body: 'Segoe UI',
    accent: '1F2328',
    accent2: '1F2328',
    muted: '656B74',
    tint: 'F4F5F6',
    nameColor: '1F2328',
    headlineColor: '656B74',
    ruleColor: 'E6E8EB',
    nameSize: 52,
    nameCaps: false,
    center: false,
    size: 19,
  },
  css: `
      :root{--ink:#1f2328;--muted:#656b74;--soft:#a3a8af;--rule:#e6e8eb}
      body{font-family:Selawik,"Factwright Sans","Segoe UI",Calibri,sans-serif;font-size:9.5pt;line-height:1.42}
      .hdr{padding-bottom:4px}
      .name{font-size:26pt;font-weight:600;line-height:1.05}
      .headline{font-size:11.5pt;color:var(--muted);margin-top:4px}
      .tagline{font-size:9.4pt;color:var(--soft);margin-top:1px}
      .contact{display:flex;flex-wrap:wrap;gap:3px 18px;font-size:9pt;color:var(--muted);margin-top:9px}
      h2{font-size:8.8pt;font-weight:600;text-transform:uppercase;letter-spacing:.9px;color:var(--muted);margin:15px 0 6px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:16px;margin-top:14px}
      .stat b{display:block;font-size:15pt;font-weight:600;line-height:1.1}
      .stat span{display:block;font-size:8.6pt;color:var(--muted);line-height:1.3;margin-top:2px}
      .comp{columns:3;column-gap:18px;margin:0;padding-left:14px;list-style-type:"–  "}
      .comp li{break-inside:avoid;margin:1px 0}.comp li::marker{color:var(--soft)}
      .job{margin-bottom:10px}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
      .title{font-weight:600;font-size:10.4pt}
      .when{font-size:8.8pt;color:var(--muted);white-space:nowrap}
      .co{color:var(--muted)}
      .intro{margin:3px 0}
      .grp{font-weight:600;margin:7px 0 1px}
      ul.b{margin:3px 0 0;padding-left:14px;list-style-type:"–  "}
      ul.b li{margin:2px 0}
      ul.b li::marker{color:var(--soft)}
      .lead{font-weight:600}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px}
      .sys{break-inside:avoid}
      .sys b{display:block;font-weight:600}.sys div{font-size:9.2pt;color:var(--muted);line-height:1.38}
      .skills .s{margin:2px 0}.skills .s b{font-weight:600}
      .proj{margin:3px 0 8px}.proj .pn{font-weight:600}.proj .ps{color:var(--muted);font-size:8.8pt}
      .edu{margin-bottom:8px}.edu .note{color:var(--muted)}
    `,
  body: BODY,
  parts: PARTS,
  letter: {
    css: `
      .hdr{padding-bottom:14px;border-bottom:1px solid var(--rule)}${letterCss({ center: false, size: 10.5, sign: 600 })}`,
    body: LETTER,
  },
};
