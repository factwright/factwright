import type { Template } from '../templates.ts';
import { BODY, PARTS } from './markup.ts';

/** Traditional and all serif, in black and white: the safest choice for formal fields. */
export const classic: Template = {
  id: 'classic',
  name: 'Classic',
  look: 'Traditional and all serif, in black and white. The safest choice for formal fields.',
  fonts: [
    'caladea-regular.woff2',
    'caladea-bold.woff2',
    'caladea-italic.woff2',
    'factwright-sans-regular.woff2',
    'factwright-sans-bold.woff2',
  ],
  titles: {
    summary: 'Summary',
    competencies: 'Areas of Expertise',
    experience: 'Professional Experience',
    education: 'Education',
    skills: 'Skills',
  },
  word: {
    head: 'Cambria',
    body: 'Cambria',
    accent: '16181D',
    accent2: '16181D',
    muted: '4A4F57',
    tint: 'F2F3F4',
    nameColor: '16181D',
    headlineColor: '16181D',
    ruleColor: '2B2F36',
    nameSize: 46,
    nameCaps: true,
    center: true,
    size: 21,
  },
  css: `
      :root{--ink:#16181d;--muted:#4a4f57;--rule:#2b2f36;--soft:#c5c9cf}
      body{font-family:Caladea,Cambria,Georgia,serif;font-size:10.4pt;line-height:1.3}
      .hdr{text-align:center;padding-bottom:2px}
      .name{font-size:23pt;font-weight:700;letter-spacing:2.6px;text-transform:uppercase;line-height:1.05}
      .headline{font-size:11.6pt;font-style:italic;margin-top:4px}
      .tagline{font-size:10pt;color:var(--muted);margin-top:1px}
      .contact{font-size:9.6pt;color:var(--muted);margin-top:5px}
      .contact span+span:before{content:"·";padding:0 8px}
      h2{font-size:10.8pt;font-weight:700;text-transform:uppercase;letter-spacing:1.1px;border-bottom:1px solid var(--rule);padding-bottom:2px;margin:12px 0 5px}
      .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);border-top:1px solid var(--soft);border-bottom:1px solid var(--soft);margin-top:9px}
      .stat{padding:5px 8px;text-align:center}.stat+.stat{border-left:1px solid var(--soft)}
      .stat b{display:block;font-size:14pt;line-height:1.1}
      .stat span{display:block;font-size:8.8pt;color:var(--muted);line-height:1.22;margin-top:1px}
      .comp{columns:3;column-gap:18px;margin:0;padding-left:15px}
      .comp li{break-inside:avoid;margin:1px 0}
      .job{margin-bottom:8px}
      .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
      .title{font-weight:700;font-size:10.8pt}
      .when{white-space:nowrap}
      .co{font-style:italic;color:var(--muted)}
      .intro{margin:2px 0}
      .grp{font-weight:700;font-style:italic;margin:5px 0 1px}
      ul.b{margin:2px 0 0;padding-left:17px}
      ul.b li{margin:1.6px 0}
      .lead{font-weight:700}
      .systems{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
      .sys{border-left:2px solid var(--soft);padding-left:9px;break-inside:avoid}
      .sys b{display:block}.sys div{font-size:9.8pt;line-height:1.28}
      .skills .s{margin:2px 0}
      .proj{margin:3px 0 6px}.proj .pn{font-weight:700}.proj .ps{font-style:italic;color:var(--muted)}
      .edu{margin-bottom:6px}.edu .note{font-size:9.8pt;color:var(--muted)}
    `,
  body: BODY,
  parts: PARTS,
};
