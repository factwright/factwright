import { readFile } from 'node:fs/promises';
import { isNewerVersion, isVersion } from '../shared/whats-new.ts';
import { saveJson } from './claude/save.ts';

export interface WhatsNewDeps {
  /**
   * The file that keeps the newest version seen, in the profile's data folder, beside its other
   * settings for this computer, and outside the workspace, so it never syncs.
   */
  file: string;
  /** The version the app is running. */
  version: string;
  /** Whether this profile had opened before this start, as its tracker was there already. */
  usedBefore: boolean;
}

/**
 * Whether what's new is due for this profile: once for each update it opens on, so each person's
 * profile hears for itself. A first install and a new profile have nothing to compare with, and
 * start from the version they're on. An update that skipped versions has the version it landed
 * on due, and the version kept never goes down, so going back to an older one says nothing, and
 * coming forward again to one already seen says nothing either.
 */
export class WhatsNewDue {
  private readonly deps: WhatsNewDeps;
  private due: string | null = null;

  constructor(deps: WhatsNewDeps) {
    this.deps = deps;
  }

  async load(): Promise<void> {
    const { version, usedBefore } = this.deps;
    const seen = await this.readSeen();
    if (seen === null && !usedBefore) {
      // The next open needs this to tell it from an update, but the app opens without it.
      await this.keep(version).catch(() => {});
      return;
    }
    // A profile used before with no version kept last ran a version from before this was kept.
    if (seen === null || isNewerVersion(version, seen)) this.due = version;
  }

  /** The version whose notes are due, or null. A Mac can open its window again and ask again. */
  current(): string | null {
    return this.due;
  }

  /** Keeps that it's been said, or passed by, so it isn't due again. Throws if it can't keep it. */
  async seen(): Promise<void> {
    if (this.due === null) return;
    await this.keep(this.due);
    this.due = null;
  }

  private keep(version: string): Promise<void> {
    return saveJson(this.deps.file, { seen: version });
  }

  /** The newest version seen, or null with none kept, or a file that won't read. */
  private async readSeen(): Promise<string | null> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.deps.file, 'utf8'));
      const seen = (saved as { seen?: unknown } | null)?.seen;
      return isVersion(seen) ? seen : null;
    } catch {
      return null;
    }
  }
}
