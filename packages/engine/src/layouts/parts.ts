import { escapeHtml, md } from '../markup.ts';
import type { Bullet, Education, Experience, Resume } from '../schema.ts';

/** A layout: its styles, and the page's body for a resume. */
export interface Theme {
  css: string;
  body: (r: Resume) => string;
}

export const dates = (e: Experience) => `${escapeHtml(e.start)} – ${escapeHtml(e.end)}`;

export const section = (title: string, inner: string) =>
  `<section><h2>${escapeHtml(title)}</h2>${inner}</section>`;

/**
 * A section whose content sits in one block. The fit check measures each piece of text inside
 * it, never the block as a whole.
 */
export const block = (title: string, inner: string) =>
  section(title, `<div class="blk">${inner}</div>`);

export function contact(r: Resume): string {
  const c = r.contact ?? {};
  const parts = [c.phone, c.email, c.linkedin, c.location, c.website].filter(Boolean);
  return `<div class="contact">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`;
}

export const statCards = (r: Resume) =>
  (r.impact_stats ?? [])
    .map((s) => `<div class="stat"><b>${escapeHtml(s.value)}</b><span>${md(s.label)}</span></div>`)
    .join('');

export function stats(r: Resume): string {
  if (!r.impact_stats?.length) return '';
  return `<div class="stats" style="--n:${r.impact_stats.length}">${statCards(r)}</div>`;
}

export const systemCards = (r: Resume) =>
  `<div class="systems">${(r.systems ?? [])
    .map((s) => `<div class="sys"><b>${escapeHtml(s.name)}</b><div>${md(s.text)}</div></div>`)
    .join('')}</div>`;

export function bullets(list: Bullet[]): string {
  const items = list.map(
    (b) => `<li>${b.lead ? `<span class="lead">${md(b.lead)}:</span> ` : ''}${md(b.text)}</li>`,
  );
  return `<ul class="b">${items.join('')}</ul>`;
}

export function jobBody(e: Experience): string {
  const groups = (e.bullet_groups ?? []).map(
    (g) =>
      `${g.heading ? `<div class="grp">${escapeHtml(g.heading)}</div>` : ''}${bullets(g.bullets)}`,
  );
  return `${e.intro ? `<div class="intro">${md(e.intro)}</div>` : ''}${groups.join('')}`;
}

export const company = (e: Experience) =>
  `${escapeHtml(e.company)}${e.company_note ? ` — ${escapeHtml(e.company_note)}` : ''}`;

/** A job with its title and dates on one line, and the company and place on the next. */
export function jobClassic(e: Experience): string {
  return `<div class="job">
    <div class="row"><div class="title">${escapeHtml(e.title)}</div><div class="when">${dates(e)}</div></div>
    <div class="row"><div class="co">${company(e)}</div><div class="co">${escapeHtml(e.location)}</div></div>
    ${jobBody(e)}</div>`;
}

export function project(p: NonNullable<Resume['projects']>[number]): string {
  return `<div class="proj"><span class="pn">${md(p.name)}</span>${p.status ? ` <span class="ps">· ${md(p.status)}</span>` : ''}${p.url ? ` <span class="ps">· ${md(p.url)}</span>` : ''}<div>${md(p.text)}</div></div>`;
}

export const skillRows = (r: Resume) =>
  `<div class="skills">${(r.skills ?? [])
    .map(
      (s) =>
        `<div class="s"><b>${escapeHtml(s.category)}:</b> ${s.items.map(escapeHtml).join(' · ')}</div>`,
    )
    .join('')}</div>`;

export const extraItems = (items: string[], className = 'b') =>
  `<ul class="${className}">${items.map((i) => `<li>${md(i)}</li>`).join('')}</ul>`;

export const header = (r: Resume) => `
  <div class="name">${escapeHtml(r.name)}</div>
  <div class="headline">${escapeHtml(r.headline)}</div>
  ${r.tagline ? `<div class="tagline">${escapeHtml(r.tagline)}</div>` : ''}`;

/** When a course of study ran, as much as the resume says. */
export const studied = (e: Education) =>
  e.start && e.end
    ? `${escapeHtml(e.start)} – ${escapeHtml(e.end)}`
    : escapeHtml(e.end ?? e.start ?? '');

/** A degree, laid out like a job: the degree and when, then the school and where. */
export function school(e: Education): string {
  const when = studied(e);
  return `<div class="edu">
    <div class="row"><div class="title">${escapeHtml(e.degree)}</div>${when ? `<div class="when">${when}</div>` : ''}</div>
    <div class="row"><div class="co">${escapeHtml(e.school)}</div>${e.location ? `<div class="co">${escapeHtml(e.location)}</div>` : ''}</div>
    ${e.note ? `<div class="note">${md(e.note)}</div>` : ''}</div>`;
}

/**
 * Splits a section between the top of the resume and its usual place, so education leads when
 * the resume says it should.
 */
export const placed = (r: Resume, html: string): { early: string; late: string } =>
  r.education_first ? { early: html, late: '' } : { early: '', late: html };
