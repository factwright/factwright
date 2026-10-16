import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CALL_ID,
  CALL_KIND_LABELS,
  type CallDocKind,
  callDocFile,
  type Job,
} from '@factwright/core';

/** The most a call's prep sheet or thank-you notes may hold: long, but not a flood. */
export const MAX_CALL_DOC = 100_000;

/** What each of Claude's documents for a call is called, in what the tools say. */
const NAMES: Readonly<Record<CallDocKind, string>> = {
  prep: 'prep sheet',
  thanks: 'thank-you notes',
};

/**
 * Saves Claude's prep sheet for one of a job's calls, or its thank-you notes after it, in the
 * call's own folder, where the app shows them on the call. Saving again replaces it. The call
 * must be one the user logged for this job.
 */
export async function saveCallDoc(
  job: Job,
  callId: string,
  kind: CallDocKind,
  markdown: string,
  workspace: string,
): Promise<string> {
  const call = job.calls.find((each) => each.id === callId);
  if (!call || !CALL_ID.test(call.id)) {
    const logged = job.calls
      .map((each) => `${each.id} (${CALL_KIND_LABELS[each.kind]}, ${each.onDate})`)
      .join(', ');
    throw new Error(
      `${job.company} has no call ${callId}. ${logged ? `Its calls are ${logged}.` : 'It has no calls logged.'}`,
    );
  }
  if (!markdown.trim()) throw new Error(`Give the ${NAMES[kind]}.`);
  if (markdown.length > MAX_CALL_DOC) {
    throw new Error(
      `Keep the ${NAMES[kind]} to ${MAX_CALL_DOC.toLocaleString('en-US')} characters.`,
    );
  }
  const path = callDocFile(job.id, call.id, kind);
  const file = join(workspace, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${markdown.trim()}\n`);
  return `Saved in ${path}. The app shows it on the ${CALL_KIND_LABELS[call.kind].toLowerCase()}.`;
}
