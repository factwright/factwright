/**
 * What the user is writing and hasn't saved, anywhere in the window, so restarting into an update
 * can ask first. Each part that keeps words typed but not saved says whether it has any.
 */
const parts = new Set<() => boolean>();

/** Adds a part of the window that keeps words typed but not saved, such as a fact being changed. */
export function keepsDrafts(hasDrafts: () => boolean): void {
  parts.add(hasDrafts);
}

/** Whether anything typed hasn't been saved. */
export const hasUnsaved = (): boolean => [...parts].some((hasDrafts) => hasDrafts());
