// Makes the files the X-ray's tests read: a made-up resume printed in Classic and Minimal, as
// PDFs and Word files, the way the app makes them, and files with each problem the X-ray looks
// for. Run it in Electron, which prints with the same Chromium as the app:
// `pnpm --filter @factwright/xray fixtures`. Run it again after a change to the templates or
// the engine, and check the tests still pass.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  builtInTemplate,
  docxFile,
  FONT_FILES,
  type FontUrls,
  previewResume,
  type Resume,
  renderHtml,
  type Template,
} from '@factwright/engine';
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  Textbox,
  TextRun,
  WidthType,
} from 'docx';
import { app, BrowserWindow } from 'electron';

const OUT = new URL('../test/fixtures/', import.meta.url);
const FONTS = new URL('../../engine/fonts/', import.meta.url);

const fonts: FontUrls = Object.fromEntries(
  FONT_FILES.map((file) => [
    file,
    `data:font/woff2;base64,${readFileSync(new URL(file, FONTS)).toString('base64')}`,
  ]),
);

const classic = builtInTemplate('classic') as Template;
const minimal = builtInTemplate('minimal') as Template;

/** Classic, with styles of its own on top. */
const restyled = (id: string, css: string, body = classic.body): Template => ({
  ...classic,
  id,
  name: id,
  css: `${classic.css}\n${css}`,
  body,
});

/** A sidebar: contact details, skills and education down the left, the rest on the right. */
const sidebar = restyled(
  'sidebar',
  `.cols{display:grid;grid-template-columns:2fr 5fr;gap:26px}
   aside h2{font-size:9.6pt}aside .blk div{margin:2px 0}`,
  `<div class="hdr">{{> header}}</div>
<div class="cols">
<aside>
<section><h2>{{titles.contact}}</h2><div class="blk">{{#contact}}<div>{{text}}</div>{{/contact}}</div></section>
<section><h2>{{titles.skills}}</h2><div class="blk">{{#skills}}<div><b>{{category}}</b></div><div>{{items_line}}</div>{{/skills}}</div></section>
{{> education}}
</aside>
<main>
<section><h2>{{titles.summary}}</h2><div class="blk"><div class="sum">{{summary}}</div></div></section>
<section><h2>{{titles.experience}}</h2><div class="blk">{{#experience}}{{> job}}{{/experience}}</div></section>
</main>
</div>`,
);

/** Headings spaced so wide that each letter reads on its own. */
const spaced = restyled('spaced', 'h2{letter-spacing:4px}');

/** Icons before the phone number and email, drawn from characters fonts don't have. */
const icons = restyled(
  'icons',
  `.contact span:nth-child(1)::before{content:"\\e0b0  "}
   .contact span:nth-child(2)::before{content:"\\e0be  "}`,
);

/**
 * Each job's dates placed at its right edge on their own, as some designs do. Chromium draws a
 * placed element after the rest of its job, so the dates are read after the job's bullets.
 */
const datesLast = restyled(
  'dates-last',
  '.job{position:relative}.job .when{position:absolute;right:0;top:0}',
);

/** The name and headline in a footer that repeats on every page. */
const footer = restyled(
  'footer',
  '.foot{position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:8pt;color:#666}',
  `${classic.body}<div class="foot">{{name}} · {{headline}}</div>`,
);

/** The made-up resume, long enough for two pages. */
function longResume(): Resume {
  const resume = previewResume();
  return {
    ...resume,
    experience: [...resume.experience, ...resume.experience, ...resume.experience],
  };
}

const PDFS: [name: string, template: Template, resume: Resume][] = [
  ['classic', classic, previewResume()],
  ['minimal', minimal, previewResume()],
  ['sidebar', sidebar, previewResume()],
  ['spaced', spaced, previewResume()],
  ['icons', icons, previewResume()],
  ['dates-last', datesLast, previewResume()],
  ['footer', footer, longResume()],
];

/** Prints a page as the app does: Letter, with backgrounds, after its fonts load. */
async function print(window: BrowserWindow, html: string): Promise<Buffer> {
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await window.webContents.executeJavaScript(
    'Promise.all([...document.fonts].map((face) => face.load().catch(() => null))).then(() => document.fonts.ready).then(() => true)',
  );
  return window.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
  });
}

const text = (words: string, options: { bold?: boolean; size?: number } = {}) =>
  new TextRun({ text: words, font: 'Calibri', size: options.size ?? 21, bold: options.bold });

const heading = (title: string) =>
  new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [text(title.toUpperCase(), { bold: true, size: 23 })],
  });

/** A job's first line: its title, then its dates at the right. */
const jobLine = (title: string, dates: string) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 10656 }],
    children: [text(title, { bold: true }), text('\t'), text(dates)],
  });

const plainLines = (lines: string[]) =>
  lines.map((line) => new Paragraph({ children: [text(line)] }));

const CONTACT = '(555) 014-2387 | jordan.avery@example.com | Denver, CO';

/** The body most of the Word files share, after the contact details. */
function wordBody(dates: [string, string] = ['04/2021 – Present', '06/2018 – 03/2021']) {
  return [
    heading('Summary'),
    ...plainLines(['Product manager with eight years in two-sided marketplaces.']),
    heading('Experience'),
    jobLine('Senior Product Manager', dates[0]),
    ...plainLines([
      'Northwind Stays',
      'Led the repeat booking program from research to launch, lifting repeat bookings by about a third.',
    ]),
    jobLine('Product Manager', dates[1]),
    ...plainLines(['Bramble Market', 'Launched same-day delivery in three cities.']),
    heading('Education'),
    ...plainLines(['B.S., Economics, University of Colorado Boulder, 2016']),
    heading('Skills'),
    ...plainLines(['Discovery · Roadmapping · A/B testing · SQL · Amplitude']),
  ];
}

const nameLine = () =>
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [text('Jordan Avery', { bold: true, size: 44 })],
  });

const DOCXES: [name: string, document: () => Document][] = [
  // Contact details in the header, which many systems skip.
  [
    'header',
    () =>
      new Document({
        sections: [
          {
            headers: { default: new Header({ children: [nameLine(), ...plainLines([CONTACT])] }) },
            footers: { default: new Footer({ children: plainLines(['References on request']) }) },
            children: wordBody(),
          },
        ],
      }),
  ],
  // Skills in a text box.
  [
    'textbox',
    () =>
      new Document({
        sections: [
          {
            children: [
              nameLine(),
              ...plainLines([CONTACT]),
              ...wordBody(),
              new Textbox({
                style: { width: '220pt', height: '60pt' },
                children: plainLines(['Certified ScrumMaster', 'Fluent in Spanish']),
              }),
            ],
          },
        ],
      }),
  ],
  // The whole resume in a table of two columns.
  [
    'table',
    () =>
      new Document({
        sections: [
          {
            children: [
              nameLine(),
              new Table({
                width: { size: 10656, type: WidthType.DXA },
                columnWidths: [3200, 7456],
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 3200, type: WidthType.DXA },
                        children: [
                          ...plainLines([CONTACT.replaceAll(' | ', ', ')]),
                          heading('Skills'),
                          ...plainLines(['Discovery, roadmapping, A/B testing, SQL and Amplitude']),
                        ],
                      }),
                      new TableCell({
                        width: { size: 7456, type: WidthType.DXA },
                        children: wordBody().slice(0, 9),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      }),
  ],
  // Two newspaper columns.
  [
    'columns',
    () =>
      new Document({
        sections: [
          {
            properties: { column: { count: 2, space: 708 } },
            children: [nameLine(), ...plainLines([CONTACT]), ...wordBody()],
          },
        ],
      }),
  ],
  // Dates in seasons and two-digit years, and letters joined into one character, as text
  // copied out of some PDFs has.
  [
    'odd-dates',
    () =>
      new Document({
        sections: [
          {
            children: [
              nameLine(),
              ...plainLines([CONTACT, 'Builds eﬃcient workﬂows for small teams.']),
              ...wordBody(['Summer 2021 – Present', '’18 – ’21']),
            ],
          },
        ],
      }),
  ],
];

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  for (const [name, template, resume] of PDFS) {
    writeFileSync(
      new URL(`${name}.pdf`, OUT),
      await print(window, renderHtml(resume, template, fonts)),
    );
    console.log(`Printed ${name}.pdf`);
  }
  for (const [name, template] of [
    ['classic', classic],
    ['minimal', minimal],
  ] as const) {
    writeFileSync(
      new URL(`${name}.docx`, OUT),
      Buffer.from(await docxFile(previewResume(), template)),
    );
    console.log(`Built ${name}.docx`);
  }
  for (const [name, document] of DOCXES) {
    writeFileSync(new URL(`${name}.docx`, OUT), await Packer.toBuffer(document()));
    console.log(`Built ${name}.docx`);
  }
  window.destroy();
  app.quit();
});
