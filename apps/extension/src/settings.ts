import { ext } from './ext.ts';

/** What you can choose about how the extension saves. */
export interface Settings {
  /**
   * Whether a LinkedIn job is saved with its posting's text, read from the page you're on when you
   * save it, or with its link and title only. Factwright's own tools never read LinkedIn.
   */
  linkedInText: boolean;
}

const DEFAULTS: Settings = { linkedInText: true };

/** Your settings, with the default for any you haven't chosen. */
export async function settings(): Promise<Settings> {
  const { settings: saved } = await ext.storage.local.get('settings');
  return {
    ...DEFAULTS,
    ...(saved && typeof saved === 'object' ? (saved as Partial<Settings>) : {}),
  };
}

/** Changes some of your settings. */
export async function changeSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...(await settings()), ...changes };
  await ext.storage.local.set({ settings: next });
  return next;
}
