/** Text made safe for HTML. */
export const escapeHtml = (value: unknown) =>
  String(value ?? '')
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
