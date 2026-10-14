import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Without a trailing separator: on Windows, Playwright quotes each argument, and a trailing
// backslash would escape the closing quote.
export const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** The stand-in Claude Code, which runs put first on PATH, so no run reaches the user's own. */
export const fakeClaude = join(desktop, 'e2e', 'fake-claude');
/** The app's version, which its sidebar shows. */
export const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  version: string;
};
