import type { CoverLetter } from '../letter.ts';
import { escapeHtml, md } from '../markup.ts';
import type { Bullet, Contact, Resume } from '../schema.ts';
import { Html, type Value } from './syntax.ts';

/** What every section is called on one resume: the template's names, with the resume's own. */
export interface ResumeTitles {
  summary: string;
  competencies: string;
  experience: string;
  education: string;
  skills: string;
  systems: string;
  projects: string;
  highlights: string;
  contact: string;
}

/** Text made safe for the page. */
const text = (value: unknown) => new Html(escapeHtml(value));

/** Text made safe for the page, with its **bold** and [[placeholders]] marked up. */
const marked = (value: unknown) => new Html(md(value));

const bullet = (b: Bullet) => ({ lead: marked(b.lead), text: marked(b.text) });

/** When a span of time ran, as much as the resume says: "2019 – 2023", "2023" or nothing. */
const span = (start: string | undefined, end: string | undefined) =>
  start && end ? `${escapeHtml(start)} – ${escapeHtml(end)}` : escapeHtml(end ?? start ?? '');

/**
 * A resume as a template sees it. Each piece of text is safe for the page already, and text a
 * resume can mark up, such as a bullet, has its **bold** in <strong>. Something the resume leaves
 * out is empty, so {{#tagline}}…{{/tagline}} shows only with a tagline.
 */
/** The contact details, in the order every template shows them. */
const contactView = (c: Contact = {}) =>
  (['phone', 'email', 'linkedin', 'location', 'website'] as const).flatMap((kind) =>
    c[kind] ? [{ kind, text: text(c[kind]) }] : [],
  );

/** What each title is called, safe for the page. */
const titlesView = (titles: ResumeTitles) =>
  Object.fromEntries(Object.entries(titles).map(([key, title]) => [key, text(title)]));

export function resumeView(r: Resume, titles: ResumeTitles): Value {
  const contact = contactView(r.contact);
  return {
    name: text(r.name),
    headline: text(r.headline),
    tagline: text(r.tagline),
    contact,
    summary: marked(r.summary),
    stats: (r.impact_stats ?? []).map((s) => ({ value: text(s.value), label: marked(s.label) })),
    competencies: (r.competencies ?? []).map(marked),
    systems: (r.systems ?? []).map((s) => ({ name: text(s.name), text: marked(s.text) })),
    experience: r.experience.map((e) => ({
      title: text(e.title),
      company: text(e.company),
      company_note: text(e.company_note),
      company_line: new Html(
        `${escapeHtml(e.company)}${e.company_note ? ` — ${escapeHtml(e.company_note)}` : ''}`,
      ),
      location: text(e.location),
      start: text(e.start),
      end: text(e.end),
      dates: new Html(`${escapeHtml(e.start)} – ${escapeHtml(e.end)}`),
      intro: marked(e.intro),
      groups: (e.bullet_groups ?? []).map((g) => ({
        heading: text(g.heading),
        bullets: g.bullets.map(bullet),
      })),
    })),
    projects: (r.projects ?? []).map((p) => ({
      name: marked(p.name),
      status: marked(p.status),
      url: marked(p.url),
      text: marked(p.text),
    })),
    education: (r.education ?? []).map((e) => ({
      degree: text(e.degree),
      school: text(e.school),
      location: text(e.location),
      start: text(e.start),
      end: text(e.end),
      dates: new Html(span(e.start, e.end)),
      note: marked(e.note),
    })),
    education_first: r.education_first === true,
    skills: (r.skills ?? []).map((s) => ({
      category: text(s.category),
      items: s.items.map(text),
      items_line: new Html(s.items.map(escapeHtml).join(' · ')),
    })),
    extra_sections: (r.extra_sections ?? []).map((x) => ({
      heading: text(x.heading),
      items: x.items.map(marked),
    })),
    titles: titlesView(titles),
  };
}

/**
 * A cover letter as a template sees it: the header a resume has, so a template's header parts
 * show it the same, then the letter. Its text is marked up as a resume's is, and the signature is
 * the name at the top unless the letter gives its own.
 */
export function letterView(l: CoverLetter, titles: ResumeTitles): Value {
  return {
    name: text(l.name),
    headline: text(l.headline),
    tagline: text(''),
    contact: contactView(l.contact),
    date: marked(l.date),
    recipient: (l.recipient ?? []).map(marked),
    greeting: marked(l.greeting),
    paragraphs: l.paragraphs.map(marked),
    closing: marked(l.closing),
    signature: marked(l.signature || l.name),
    titles: titlesView(titles),
  };
}

/**
 * Every name a template can use, at any depth, so a misspelled one is caught when the template
 * is checked rather than showing nothing. "length" is a list's length, such as stats.length.
 */
export const VIEW_NAMES: ReadonlySet<string> = new Set([
  ...['name', 'headline', 'tagline', 'contact', 'kind', 'text', 'summary', 'stats', 'value'],
  ...['label', 'competencies', 'systems', 'experience', 'title', 'company', 'company_note'],
  ...['company_line', 'location', 'start', 'end', 'dates', 'intro', 'groups', 'heading'],
  ...['bullets', 'lead', 'projects', 'status', 'url', 'education', 'degree', 'school', 'note'],
  ...['education_first', 'skills', 'category', 'items', 'items_line', 'extra_sections'],
  ...['titles', 'highlights', 'length'],
]);

/**
 * Every name a letter's markup can use, at any depth: the header a resume has, the letter's own
 * parts, and the titles, which a header part can show.
 */
export const LETTER_VIEW_NAMES: ReadonlySet<string> = new Set([
  ...['name', 'headline', 'tagline', 'contact', 'kind', 'text', 'date', 'recipient'],
  ...['greeting', 'paragraphs', 'closing', 'signature', 'titles', 'summary', 'competencies'],
  ...['experience', 'education', 'skills', 'systems', 'projects', 'highlights', 'length'],
]);
