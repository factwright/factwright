/** Special steps for applying to a job, from its apply.md or the job search's notes. */
export interface ApplySteps {
  /** The one thing to know, in Markdown, such as "Email the founder, not the form". */
  alert: string | null;
  /** An address to apply by email, when there is one. */
  email: string | null;
  /** The exact subject line to use. */
  subject: string | null;
  /** The rest of the steps, in Markdown. */
  steps: string;
}

const EMAIL = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;

/** A "- **Name:** value" line's value. */
function field(markdown: string, name: string): string | null {
  return markdown.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? null;
}

/** A value without the marks around it: quotes, backticks and bold. */
const bare = (value: string | null) => value?.replace(/[`*"“”]/g, '').trim() || null;

/**
 * Reads apply.md: an "Alert" line, then optional "Email" and "Subject" lines, then the steps.
 * An email only counts when it's a whole address.
 */
export function readApplySteps(markdown: string): ApplySteps {
  const email = bare(field(markdown, 'Email'));
  return {
    alert: field(markdown, 'Alert'),
    email: email && EMAIL.test(email) ? email : null,
    subject: bare(field(markdown, 'Subject')),
    steps: markdown
      .replace(/^#\s.*$/m, '')
      .replace(/^- \*\*(Alert|Email|Subject):\*\*.*$/gim, '')
      .trim(),
  };
}
