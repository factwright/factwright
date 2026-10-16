import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';
import type { CoverLetter } from './letter.ts';
import { BOLD, PLACEHOLDER, plainLetters } from './markup.ts';
import type { Bullet, Contact, Resume } from './schema.ts';
import { sectionTitles } from './template/render.ts';
import type { Template, WordTheme } from './templates.ts';

/** Letter width, and 0.55-inch side margins, in twentieths of a point. */
const PAGE_W = 12240;
const MARGIN = 792;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RunOptions = { bold?: boolean; italics?: boolean; color?: string; size?: number };

const MARKED = new RegExp(`(${BOLD}|${PLACEHOLDER})`, 'g');
const IS_BOLD = new RegExp(`^${BOLD}$`);
const IS_PLACEHOLDER = new RegExp(`^${PLACEHOLDER}$`);

/** Characters a Word file can't hold, which would make Word call the file unreadable. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it finds.
const UNWRITABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Text runs with **bold** and highlighted [[placeholders]], and its letters written out. */
function runs(value: unknown, t: WordTheme, base: RunOptions = {}): TextRun[] {
  return plainLetters(String(value ?? ''))
    .replace(UNWRITABLE, '')
    .split(MARKED)
    .filter(Boolean)
    .map((part) => {
      const bold = IS_BOLD.test(part);
      const placeholder = IS_PLACEHOLDER.test(part);
      return new TextRun({
        text: bold ? part.slice(2, -2) : placeholder ? `[${part.slice(2, -2)}]` : part,
        font: t.body,
        size: t.size,
        ...base,
        bold: bold || base.bold,
        ...(placeholder ? { highlight: 'yellow' } : {}),
      });
    });
}

function heading(title: string, t: WordTheme): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: t.accent, space: 2 } },
    children: [
      new TextRun({
        text: plainLetters(title).toUpperCase(),
        font: t.head,
        size: 23,
        bold: true,
        color: t.accent,
        characterSpacing: 30,
      }),
    ],
  });
}

function bullet(b: Bullet, t: WordTheme): Paragraph {
  const children: TextRun[] = [];
  if (b.lead) children.push(...runs(`${b.lead}: `, t, { bold: true, color: t.accent2 }));
  children.push(...runs(b.text, t));
  return new Paragraph({
    numbering: { reference: 'dot', level: 0 },
    spacing: { after: 40 },
    children,
  });
}

function twoSide(left: string, right: string, t: WordTheme, options: RunOptions): Paragraph {
  return new Paragraph({
    keepNext: true,
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
    spacing: { after: 10 },
    children: [
      ...runs(left, t, options),
      new TextRun({ text: '\t', font: t.body }),
      ...runs(right, t, options),
    ],
  });
}

function statsTable(stats: NonNullable<Resume['impact_stats']>, t: WordTheme): Table {
  const n = stats.length;
  const w = Math.floor(CONTENT_W / n);
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const white = { style: BorderStyle.SINGLE, size: 24, color: 'FFFFFF' };
  return new Table({
    width: { size: w * n, type: WidthType.DXA },
    columnWidths: Array(n).fill(w),
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: stats.map(
          (s) =>
            new TableCell({
              width: { size: w, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: t.tint, color: 'auto' },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 18, color: t.accent },
                bottom: none,
                left: white,
                right: white,
              },
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: plainLetters(s.value),
                      font: t.head,
                      size: 30,
                      bold: true,
                      color: t.accent,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: runs(s.label, t, { size: 16, color: t.muted }),
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

/** Who a resume or letter is from, as its header shows them. */
interface Person {
  name: string;
  headline?: string;
  tagline?: string;
  contact?: Contact;
}

/**
 * The name, headline and contact line across the top, over a rule: the same on a resume and its
 * cover letter, so the two look like a set.
 */
function header(person: Person, t: WordTheme): Paragraph[] {
  const c = person.contact ?? {};
  const align = t.center ? AlignmentType.CENTER : AlignmentType.LEFT;
  const kids: Paragraph[] = [];
  kids.push(
    new Paragraph({
      alignment: align,
      children: [
        new TextRun({
          text: plainLetters(t.nameCaps ? person.name.toUpperCase() : person.name),
          font: t.head,
          size: t.nameSize,
          bold: true,
          color: t.nameColor,
          characterSpacing: t.nameCaps ? 40 : 0,
        }),
      ],
    }),
  );
  if (person.headline !== undefined) {
    kids.push(
      new Paragraph({
        alignment: align,
        spacing: { before: 40 },
        children: [
          new TextRun({
            text: plainLetters(person.headline),
            font: t.body,
            size: 24,
            bold: true,
            color: t.headlineColor,
          }),
        ],
      }),
    );
  }
  if (person.tagline) {
    kids.push(
      new Paragraph({
        alignment: align,
        children: runs(person.tagline, t, { color: t.muted, size: t.size - 1 }),
      }),
    );
  }
  kids.push(
    new Paragraph({
      alignment: align,
      spacing: { before: 60, after: 120 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 12,
          color: t.ruleColor,
          space: 6,
        },
      },
      children: runs(
        [c.phone, c.email, c.linkedin, c.location, c.website].filter(Boolean).join('   |   '),
        t,
        { color: t.muted, size: t.size - 1 },
      ),
    }),
  );
  return kids;
}

/**
 * A resume as a single-column Word document that applicant systems read well, in the colors and
 * fonts of its template.
 */
export function resumeDocument(r: Resume, template: Template): Document {
  const t = template.word;
  const titles = sectionTitles(template, r);
  const kids: (Paragraph | Table)[] = [...header(r, t)];

  kids.push(heading(titles.summary, t));
  kids.push(new Paragraph({ spacing: { after: 60 }, children: runs(r.summary, t) }));

  if (r.impact_stats?.length) {
    kids.push(new Paragraph({ spacing: { before: 60 }, children: [] }));
    kids.push(statsTable(r.impact_stats, t));
  }

  if (r.competencies?.length) {
    kids.push(heading(titles.competencies, t));
    kids.push(new Paragraph({ children: runs(r.competencies.join('  •  '), t) }));
  }

  if (r.systems?.length) {
    kids.push(heading(titles.systems, t));
    for (const s of r.systems) kids.push(bullet({ lead: s.name, text: s.text }, t));
  }

  const education = () => {
    if (!r.education?.length) return;
    kids.push(heading(titles.education, t));
    r.education.forEach((e, i) => {
      const when = e.start && e.end ? `${e.start} – ${e.end}` : (e.end ?? e.start ?? '');
      kids.push(
        new Paragraph({
          spacing: { before: i ? 100 : 40 },
          keepNext: true,
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
          children: [
            ...runs(e.degree, t, { bold: true, size: t.size + 1 }),
            new TextRun({ text: '\t' }),
            ...runs(when, t, { bold: true, color: t.accent }),
          ],
        }),
      );
      kids.push(twoSide(e.school, e.location ?? '', t, { italics: true, color: t.muted }));
      if (e.note) kids.push(new Paragraph({ spacing: { after: 40 }, children: runs(e.note, t) }));
    });
  };
  if (r.education_first) education();

  kids.push(heading(titles.experience, t));
  r.experience.forEach((e, i) => {
    kids.push(
      new Paragraph({
        spacing: { before: i ? 140 : 40 },
        keepNext: true,
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        children: [
          ...runs(e.title, t, { bold: true, size: t.size + 2 }),
          new TextRun({ text: '\t' }),
          ...runs(`${e.start} – ${e.end}`, t, { bold: true, color: t.accent }),
        ],
      }),
    );
    kids.push(
      twoSide(`${e.company}${e.company_note ? ` — ${e.company_note}` : ''}`, e.location ?? '', t, {
        italics: true,
        color: t.muted,
      }),
    );
    if (e.intro)
      kids.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: runs(e.intro, t) }));
    for (const g of e.bullet_groups ?? []) {
      if (g.heading) {
        kids.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 80, after: 20 },
            children: [
              new TextRun({
                text: plainLetters(g.heading).toUpperCase(),
                font: t.body,
                size: t.size - 1,
                bold: true,
                color: t.accent,
                characterSpacing: 15,
              }),
            ],
          }),
        );
      }
      for (const b of g.bullets) kids.push(bullet(b, t));
    }
  });

  if (r.projects?.length) {
    kids.push(heading(titles.projects, t));
    for (const p of r.projects) {
      const extra = [p.status, p.url]
        .filter(Boolean)
        .map((x) => `  ·  ${x}`)
        .join('');
      kids.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 60 },
          children: [
            ...runs(p.name, t, { bold: true }),
            ...runs(extra, t, { color: t.accent, bold: true, size: t.size - 1 }),
          ],
        }),
      );
      kids.push(new Paragraph({ spacing: { after: 60 }, children: runs(p.text, t) }));
    }
  }

  if (!r.education_first) education();

  if (r.skills?.length) {
    kids.push(heading(titles.skills, t));
    for (const s of r.skills) {
      kids.push(
        new Paragraph({
          spacing: { after: 30 },
          children: [
            ...runs(`${s.category}: `, t, { bold: true, color: t.accent }),
            ...runs(s.items.join(' · '), t),
          ],
        }),
      );
    }
  }

  for (const x of r.extra_sections ?? []) {
    kids.push(heading(x.heading, t));
    for (const item of x.items) kids.push(bullet({ text: item }, t));
  }

  return new Document({
    creator: r.name,
    title: `${r.name} — Resume`,
    // noProof hides spell-check squiggles under tech terms.
    styles: { default: { document: { run: { font: t.body, size: t.size, noProof: true } } } },
    numbering: {
      config: [
        {
          reference: 'dot',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 300, hanging: 220 } },
                run: { color: t.accent },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: 15840 },
            margin: { top: 720, bottom: 720, left: MARGIN, right: MARGIN },
          },
        },
        children: kids,
      },
    ],
  });
}

/** The resume as a Word file's bytes, ready to save. */
export function docxFile(resume: Resume, template: Template): Promise<ArrayBuffer> {
  return Packer.toArrayBuffer(resumeDocument(resume, template));
}

/**
 * A cover letter as a Word document, under the same header as its resume, in the template's
 * fonts and colors: the date, who it's to, the letter, and the name under the closing. Its text
 * is a little larger than a resume's, and its sides an inch, as a letter's are.
 */
export function letterDocument(l: CoverLetter, template: Template): Document {
  const t = template.word;
  const size = Math.max(t.size, 21);
  const text = (value: string, options: RunOptions = {}) => runs(value, t, { size, ...options });
  const kids: Paragraph[] = [...header(l, t)];
  const to = l.recipient ?? [];
  if (l.date) kids.push(new Paragraph({ spacing: { before: 360 }, children: text(l.date) }));
  to.forEach((line, i) => {
    kids.push(
      new Paragraph({
        spacing: { before: i === 0 ? (l.date ? 240 : 360) : 0 },
        children: text(line),
      }),
    );
  });
  kids.push(
    new Paragraph({
      spacing: { before: l.date || to.length > 0 ? 240 : 360, after: 200 },
      children: text(l.greeting),
    }),
  );
  for (const paragraph of l.paragraphs) {
    kids.push(new Paragraph({ spacing: { after: 200, line: 276 }, children: text(paragraph) }));
  }
  kids.push(new Paragraph({ spacing: { before: 120 }, keepNext: true, children: text(l.closing) }));
  kids.push(
    new Paragraph({
      spacing: { before: 480 },
      children: text(l.signature || l.name, { bold: true }),
    }),
  );
  return new Document({
    creator: l.name,
    title: `${l.name} — Cover Letter`,
    styles: { default: { document: { run: { font: t.body, size, noProof: true } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: 15840 },
            margin: { top: 720, bottom: 720, left: 1440, right: 1440 },
          },
        },
        children: kids,
      },
    ],
  });
}

/** The cover letter as a Word file's bytes, ready to save. */
export function letterDocxFile(letter: CoverLetter, template: Template): Promise<ArrayBuffer> {
  return Packer.toArrayBuffer(letterDocument(letter, template));
}
