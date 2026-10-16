import type { JobToSave, SaveResult } from './save.ts';

/** What the extension's own pages ask its background to do. */
export type Message = { type: 'save'; job: JobToSave };

/** Whether something is a save the popup asked for, with every field a string. */
export function isSave(message: unknown): message is Message {
  if (!message || typeof message !== 'object') return false;
  const { type, job } = message as { type?: unknown; job?: unknown };
  if (type !== 'save' || !job || typeof job !== 'object') return false;
  const fields = job as Record<string, unknown>;
  return ['url', 'site', 'company', 'role', 'pay', 'posting'].every(
    (field) => typeof fields[field] === 'string',
  );
}

/** Asks the background to save a job, and waits for how it went. */
export async function askToSave(
  send: (message: unknown) => Promise<unknown>,
  job: JobToSave,
): Promise<SaveResult> {
  const answer = (await send({ type: 'save', job } satisfies Message)) as SaveResult | undefined;
  return (
    answer ?? { ok: false, reason: 'failed', message: 'The extension didn’t answer. Try again.' }
  );
}
