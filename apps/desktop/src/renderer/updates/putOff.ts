import type { UpdateStatus } from '../../shared/updates.ts';

/** The update the user put off with Remind me tomorrow, and the day they did, as "YYYY-MM-DD". */
export interface PutOff {
  version: string;
  day: string;
}

export const isPutOff = (value: unknown): value is PutOff | null =>
  value === null ||
  (typeof value === 'object' &&
    typeof (value as PutOff).version === 'string' &&
    typeof (value as PutOff).day === 'string');

/**
 * Whether the strip across the window shows the update: once one is ready, unless the user put
 * that one off today. A newer update, or the next day, shows it again.
 */
export function inBanner(status: UpdateStatus, putOff: PutOff | null, today: string): boolean {
  return status.state === 'ready' && !(putOff?.version === status.version && putOff.day === today);
}
