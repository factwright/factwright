/** Letters typed as one character, such as "ﬁ", as text copied out of some PDFs has them. */
const JOINED = /[\uFB00-\uFB06]/g;

/**
 * Text made safe for HTML. Letters typed as one character are written out, "ﬁ" as "fi": the
 * fonts a page carries don't have those characters, and applicant systems misread them.
 */
export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(JOINED, (joined) => joined.normalize('NFKC'))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** **Bold** text, as a resume marks it. */
export const BOLD = String.raw`\*\*.+?\*\*`;

/**
 * A [[placeholder]], for what a resume still needs filled in. Placeholders are short, so one is
 * read to at most 200 characters, and a "[[" left open is found out without reading to the end of
 * the text each time.
 */
export const PLACEHOLDER = String.raw`\[\[.{1,200}?\]\]`;

/** Text with **bold** and [[placeholders]] marked up. */
export const md = (value: unknown) =>
  escapeHtml(value)
    .replace(new RegExp(BOLD, 'g'), (bold) => `<strong>${bold.slice(2, -2)}</strong>`)
    .replace(
      new RegExp(PLACEHOLDER, 'g'),
      (placeholder) => `<mark class="ph">[${placeholder.slice(2, -2)}]</mark>`,
    );
