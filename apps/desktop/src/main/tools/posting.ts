import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  localDate,
  type Posting,
  postingRequests,
  postingSource,
  readPosting,
  WORKSPACE_PATHS,
} from '@factwright/core';
import { FetchRefused, fetchPublic } from './safe-fetch.ts';

/** Less text than this means the page needs a browser or a sign-in to show the posting. */
const MIN_POSTING_LENGTH = 400;
/** Claude Code waits a minute for a tool's answer, so saving stops trying well before then. */
const TIME_LIMIT_MS = 45_000;

/** A job's folder name, such as "2026-10-11-acme-staff-engineer": no slashes, nothing hidden. */
export const FOLDER_NAME = /^[\w][\w.-]{0,119}$/;

export interface SavePostingDeps {
  workspace: string;
  /** Fetches a public page or API within a time limit, in milliseconds. Tests pass their own. */
  fetch?: (url: string, json: boolean, limitMs: number) => Promise<unknown>;
  now?: () => Date;
}

type Fetch = (url: string, json: boolean) => Promise<unknown>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readFrom(url: string, fetch: Fetch) {
  const source = postingSource(url);
  let failure: unknown = null;
  for (const attempt of postingRequests(source)) {
    try {
      const posting = readPosting(source, await fetch(attempt.url, attempt.json));
      if (posting) return posting;
    } catch (error) {
      if (error instanceof FetchRefused) throw error;
      failure = error;
    }
  }
  if (source.kind === 'page') {
    if (failure) throw failure;
    return null;
  }
  // The applicant system's API didn't have it, so read the page itself.
  const page = { kind: 'page' as const, url: new URL(url).href };
  return readPosting(page, await fetch(page.url, false));
}

/**
 * Saves a job posting word for word, straight from its source, as posting.md in the job's
 * folder, so it survives the link going dead. A posting already saved there is kept, since
 * it's the one the user saw. Says, in words for Claude, what happened.
 */
export async function savePosting(
  url: string,
  folder: string,
  deps: SavePostingDeps,
): Promise<string> {
  const saved = `${WORKSPACE_PATHS.jobs}/${folder}/posting.md`;
  const ask = `Ask the user to paste the posting, then save it as ${saved} with a "- **Source:** pasted by the user" line on top.`;
  if (!FOLDER_NAME.test(folder)) {
    return `“${folder}” isn’t a job folder name. Use the folder’s own name, such as 2026-10-11-acme-staff-engineer.`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `“${url}” isn’t a link.`;
  }
  const dir = join(deps.workspace, WORKSPACE_PATHS.jobs, folder);
  const file = join(dir, 'posting.md');
  const kept = `Kept the posting already saved in ${saved}.`;
  if (await exists(file)) return kept;

  const clock = deps.now ?? (() => new Date());
  const giveUpAt = clock().getTime() + TIME_LIMIT_MS;
  const fetch = deps.fetch ?? fetchPublic;
  const fetchInTime: Fetch = async (address, json) => {
    const left = giveUpAt - clock().getTime();
    if (left <= 0) throw new Error('the site took too long to answer');
    return fetch(address, json, left);
  };
  let posting: Posting | null;
  try {
    posting = await readFrom(parsed.href, fetchInTime);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the page didn’t load';
    return error instanceof FetchRefused
      ? `Not saved: ${reason}`
      : `Couldn’t read the posting (${reason}). ${ask}`;
  }
  if (!posting || posting.text.length < MIN_POSTING_LENGTH) {
    const size = posting?.text.length ?? 0;
    return `Got only ${size} characters, so the page probably needs a browser or a sign-in. ${ask}`;
  }
  const body = [
    '# Job posting',
    '',
    `- **Source:** ${parsed.href}`,
    `- **Saved:** ${localDate(clock())} by Factwright (${posting.via}), word for word`,
    '',
    '---',
    '',
    posting.text,
    '',
  ].join('\n');
  await mkdir(dir, { recursive: true });
  try {
    // Never over a file that turned up meanwhile, nor through a link in its place.
    await writeFile(file, body, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return kept;
    throw error;
  }
  return `Saved ${saved} (${posting.text.length} characters, via ${posting.via}).`;
}
