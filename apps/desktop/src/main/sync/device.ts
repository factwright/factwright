import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Characters no file name on Windows can hold, which conflict copies are named with. */
const UNSAFE = /[<>:"/\\|?*]/g;

/** A computer's name as its owner knows it, tidied so a file name can hold it. */
export function tidyName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it drops.
  const tidy = name.replace(/[\u0000-\u001f]/g, '').replace(UNSAFE, ' ');
  return tidy.replace(/\s+/g, ' ').trim().slice(0, 60) || 'This computer';
}

/**
 * This computer's name, such as "Sam’s MacBook Pro": the name the Mac shows in its settings,
 * or Windows' computer name. Other devices see it on conflict copies and the account page.
 */
export async function computerName(platform = process.platform): Promise<string> {
  if (platform === 'darwin') {
    try {
      const { stdout } = await run('/usr/sbin/scutil', ['--get', 'ComputerName']);
      if (stdout.trim()) return tidyName(stdout);
    } catch {
      // Fall back to the network name.
    }
  }
  return tidyName(hostname().replace(/\.local$/i, ''));
}

/**
 * What the app tells the sync server it is: its name and version, then the computer's name,
 * percent-encoded since a header can't hold a curly apostrophe.
 */
export const userAgent = (version: string, computer: string) =>
  `Factwright/${version} (${encodeURIComponent(computer)})`;
