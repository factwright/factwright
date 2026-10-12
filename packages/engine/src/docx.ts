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
import type { Bullet, Resume } from './schema.ts';
import { sectionTitles } from './template/render.ts';
import type { Template, WordTheme } from './templates.ts';

/** Letter width, and 0.55-inch side margins, in twentieths of a point. */
const PAGE_W = 12240;
const MARGIN = 792;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RunOptions = { bold?: boolean; italics?: boolean; color?: string; size?: number };

/** Text runs with **bold** and highlighted [[placeholders]]. */
function runs(value: unknown, t: WordTheme, base: RunOptions = {}): TextRun[] {
  return String(value ?? '')
    .split(/(\*\*.+?\*\*|\[\[.+?\]\])/g)
    .filter(Boolean)
    .map((part) => {
      const bold = /^\*\*.+\*\*$/.test(part);
      const placeholder = /^\[\[.+\]\]$/.test(part);
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
        text: title.toUpperCase(),
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
                      text: s.value,
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

/**
 * A resume as a single-column Word document that applicant systems read well, in the colors and
 * fonts of its template.
 */
export function resumeDocument(r: Resume, template: Template): Document {
  const t = template.word;
  const titles = sectionTitles(template, r);
  const c = r.contact ?? {};
  const align = t.center ? AlignmentType.CENTER : AlignmentType.LEFT;
  const kids: (Paragraph | Table)[] = [];

  kids.push(
    new Paragraph({
      alignment: align,
      children: [
        new TextRun({
          text: t.nameCaps ? r.name.toUpperCase() : r.name,
          font: t.head,
          size: t.nameSize,
          bold: true,
          color: t.nameColor,
          characterSpacing: t.nameCaps ? 40 : 0,
        }),
      ],
    }),
  );
  kids.push(
    new Paragraph({
      alignment: align,
      spacing: { before: 40 },
      children: [
        new TextRun({
          text: r.headline,
          font: t.body,
          size: 24,
          bold: true,
          color: t.headlineColor,
        }),
      ],
    }),
  );
  if (r.tagline) {
    kids.push(
      new Paragraph({
        alignment: align,
        children: runs(r.tagline, t, { color: t.muted, size: t.size - 1 }),
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
                text: g.heading.toUpperCase(),
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
