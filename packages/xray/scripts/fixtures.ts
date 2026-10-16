// Makes the files the X-ray's tests read: a made-up resume printed in Classic and Minimal, as
// PDFs and Word files, the way the app makes them, files with each problem the X-ray looks for,
// and words with fi and fl, in the app's templates and one of a user's own, which must read as
// letters. Run it in Electron, which prints with the same Chromium as the app:
// `pnpm --filter @factwright/xray fixtures`. Run it again after a change to the templates, the
// engine or its fonts, or Electron, and check the tests still pass.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  builtInTemplate,
  type CoverLetter,
  docxFile,
  FONT_FILES,
  type FontUrls,
  previewLetter,
  previewResume,
  type Resume,
  readTemplate,
  renderHtml,
  renderLetterHtml,
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

/**
 * A template of the user's own, read from its file as the app reads one, in fonts many people's
 * use: its text in Factwright Sans, Calibri's stand-in, its headings in Barlow, and its name and
 * headline in Caladea. Its styles ask for letters joined into one, which the fonts draw as one
 * shape but write into the PDF as letters. It has no letter of its own, so a letter prints plainly.
 */
function ownTemplate(): Template {
  const read = readTemplate(
    {
      factwright: 'resume-template',
      version: 1,
      name: 'Own',
      look: 'Sans-serif text under a serif name, with condensed headings.',
      fonts: [
        'factwright-sans-regular.woff2',
        'factwright-sans-bold.woff2',
        'factwright-sans-italic.woff2',
        'caladea-bold.woff2',
        'caladea-italic.woff2',
        'barlow-bold.woff2',
      ],
      titles: {
        summary: 'Profile',
        competencies: 'Proficiencies',
        experience: 'Professional Experience',
        education: 'Education',
        skills: 'Skills',
      },
      word: { ...classic.word, head: 'Cambria', body: 'Calibri' },
      css: `${classic.css}
        body{font-family:"Factwright Sans",Calibri,sans-serif}
        .name,.headline{font-family:Caladea,Cambria,serif}
        h2{font-family:Barlow,"Factwright Sans",sans-serif;text-transform:none;letter-spacing:0}
        body{font-variant-ligatures:common-ligatures discretionary-ligatures;font-feature-settings:"liga" 1,"dlig" 1}`,
      body: classic.body.replace(
        '<div class="sum">',
        `<div class="sum" style="font-feature-settings:'liga' 1 !important">`,
      ),
      parts: classic.parts,
    },
    'own',
  );
  if (!read.ok) throw new Error(read.problems.join('\n'));
  return read.template;
}

/**
 * Jordan Avery as a financial planner, in words with fi, fl, ff, ffi and ffl, which fonts can
 * draw as one shape: certified, first, profile, office, workflow, staff, efficient and affluent.
 * They're in every style a template sets: plain, bold and italic text, headings and small print.
 */
function plannerResume(): Resume {
  const resume = previewResume();
  return {
    ...resume,
    headline: 'Certified Financial Planner',
    tagline: 'Affluent families · Efficient offices · First-time investors',
    summary:
      'Certified planner who fills the first meeting with **efficient** questions, and builds the office workflow that staff and affluent clients rely on.',
    impact_stats: [
      { value: '~20%', label: 'Less staff time on filing' },
      { value: '4', label: 'Offices on one workflow' },
      { value: '$2.4M', label: 'New assets in the first year' },
      { value: '12', label: 'Staff certified' },
    ],
    competencies: [
      'Financial planning',
      'Profile reviews',
      'Staff coaching',
      'Workflow design',
      'Office efficiency',
      'Affluent families',
    ],
    systems_heading: 'Selected Work',
    systems: [
      {
        name: 'First-meeting workflow',
        text: 'A profile form and checklist that fit the first meeting into an hour, with no files lost.',
      },
      {
        name: 'Office efficiency review',
        text: 'Found a fifth of staff time going to filing, and gave it back with one shared workflow.',
      },
    ],
    experience: [
      {
        title: 'Senior Financial Planner',
        company: 'Northwind Advisors',
        company_note: 'Family office for affluent clients',
        location: 'Denver, CO',
        start: '04/2021',
        end: 'Present',
        bullet_groups: [
          {
            heading: 'Staffing',
            bullets: [
              {
                lead: 'Workflow',
                text: 'Rebuilt the office workflow for 12 staff, cutting the time to a first offer by **a fifth**.',
              },
              { text: 'Certified three planners, and filed every client profile within a week.' },
            ],
          },
        ],
      },
      {
        title: 'Financial Planner',
        company: 'Bramble Wealth',
        company_note: 'Office of first-time investors',
        location: 'Remote',
        start: '06/2018',
        end: '03/2021',
        bullet_groups: [
          {
            bullets: [
              {
                text: 'Brought efficient, flat-fee planning to first-time investors in three cities.',
              },
            ],
          },
        ],
      },
    ],
    projects: [],
    education: [
      {
        degree: 'B.S., Finance',
        school: 'University of Colorado Boulder',
        location: 'Boulder, CO',
        end: '2016',
        note: 'Certificate in financial planning',
      },
    ],
    skills: [
      { category: 'Planning', items: ['Cash flow', 'Retirement', 'Estate efficiency'] },
      { category: 'Tools', items: ['Microsoft Office', 'eMoney', 'Profile scoring'] },
    ],
    extra_sections: [
      { heading: 'Certifications', items: ['Certified Financial Planner (CFP), 2019'] },
      { heading: 'Affiliations', items: ['Financial Planning Association, Denver chapter'] },
    ],
  };
}

/** Jordan Avery's cover letter as a financial planner, in the same words. */
function plannerLetter(): CoverLetter {
  return {
    ...previewLetter(),
    headline: 'Certified Financial Planner',
    recipient: ['Priya Shah', 'Director of Planning', 'Fernway Wealth'],
    paragraphs: [
      'Fernway’s posting asks for a certified planner who can run an efficient office for affluent families. That is the work I have done for the last three years at Northwind Advisors, where the first-meeting workflow I built fits a new client’s first meeting into an hour, with no files lost.',
      'Two parts of that work fit what your team is taking on. First, I keep every client profile current: our staff file each one within a week. Second, I find where time goes: an office efficiency review showed a fifth of staff time going to filing, and one shared workflow gave it back.',
      'I would welcome half an hour to walk through the workflow, and what I would offer Fernway’s affluent clients first.',
    ],
  };
}

/** The made-up resume, long enough for two pages. */
function longResume(): Resume {
  const resume = previewResume();
  return {
    ...resume,
    experience: [...resume.experience, ...resume.experience, ...resume.experience],
  };
}

/**
 * A made-up engineer, Alex Rivera, whose resume matches the fact bank and jobs the desktop app's
 * sample screens show, so the screens can show a real X-ray.
 */
function engineerResume(): Resume {
  return {
    name: 'Alex Rivera',
    headline: 'Staff Platform Engineer',
    tagline: 'Developer platforms · Kubernetes · Go',
    contact: {
      phone: '(555) 019-4420',
      email: 'alex@example.com',
      linkedin: 'linkedin.com/in/alex-rivera',
      location: 'Denver, CO',
    },
    summary:
      'Platform engineer who builds the tools other engineers rely on. Moved twelve services onto one deploy pipeline, and took over and finished offline sync for a field app used by 3,000 technicians.',
    impact_stats: [
      { value: '~40%', label: 'Faster deploys' },
      { value: '12', label: 'Services on one pipeline' },
      { value: '3,000', label: 'Technicians on the field app' },
    ],
    competencies: ['Platform engineering', 'CI/CD', 'Kubernetes', 'Go', 'TypeScript', 'Mentoring'],
    experience: [
      {
        title: 'Platform Engineering Lead',
        company: 'Tidewater Analytics',
        company_note: 'Water-quality analytics',
        location: 'Denver, CO',
        start: '03/2021',
        end: 'Present',
        bullet_groups: [
          {
            bullets: [
              {
                lead: 'Pipelines',
                text: 'Moved 12 services onto one deploy pipeline, cutting deploy time **~40%** and on-call pages by half.',
              },
              { text: 'Led the team of 6 that runs the platform the other teams ship on.' },
            ],
          },
        ],
      },
      {
        title: 'Software Engineer',
        company: 'Beacon Labs',
        company_note: 'Field-service scheduling',
        location: 'Remote',
        start: '06/2016',
        end: '02/2021',
        bullet_groups: [
          {
            bullets: [
              {
                text: 'Took over and finished offline sync for the field app, used by **3,000** technicians.',
              },
            ],
          },
        ],
      },
    ],
    education: [
      { degree: 'B.S., Computer Science', school: 'Colorado State University', end: '2012' },
    ],
    skills: [
      { category: 'Languages', items: ['Go', 'TypeScript'] },
      { category: 'Platform', items: ['Kubernetes', 'CI/CD'] },
    ],
  };
}

const own = ownTemplate();

const PDFS: [name: string, template: Template, resume: Resume][] = [
  ['classic', classic, previewResume()],
  ['engineer', classic, engineerResume()],
  ['minimal', minimal, previewResume()],
  ['sidebar', sidebar, previewResume()],
  ['spaced', spaced, previewResume()],
  ['icons', icons, previewResume()],
  ['dates-last', datesLast, previewResume()],
  ['footer', footer, longResume()],
  ['fi-classic', classic, plannerResume()],
  ['fi-minimal', minimal, plannerResume()],
  ['fi-own', own, plannerResume()],
];

/**
 * A template in Classic's look whose Word files are in Garamond, as one made from a Garamond
 * resume can be, with no letter of its own. The app carries no Garamond, so a letter prints in
 * the serif the template carries.
 */
const garamond: Template = {
  ...classic,
  id: 'garamond',
  name: 'garamond',
  word: { ...classic.word, head: 'Garamond', body: 'Garamond' },
  letter: undefined,
};

/** Cover letters. A template with no letter of its own, such as own, prints one plainly. */
const LETTERS: [name: string, template: Template, letter: CoverLetter][] = [
  ['fi-letter', own, plannerLetter()],
  ['fi-letter-garamond', garamond, plannerLetter()],
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
  for (const [name, template, letter] of LETTERS) {
    writeFileSync(
      new URL(`${name}.pdf`, OUT),
      await print(window, renderLetterHtml(letter, template, fonts)),
    );
    console.log(`Printed ${name}.pdf`);
  }
  for (const [name, template, resume] of [
    ['classic', classic, previewResume()],
    ['minimal', minimal, previewResume()],
    ['engineer', classic, engineerResume()],
  ] as const) {
    writeFileSync(new URL(`${name}.docx`, OUT), Buffer.from(await docxFile(resume, template)));
    console.log(`Built ${name}.docx`);
  }
  for (const [name, document] of DOCXES) {
    writeFileSync(new URL(`${name}.docx`, OUT), await Packer.toBuffer(document()));
    console.log(`Built ${name}.docx`);
  }
  window.destroy();
  app.quit();
});
