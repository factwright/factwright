import { ext } from './ext.ts';
import { DEFAULT_SERVER, readServer } from './server.ts';

/** What you can choose about how the extension saves. */
export interface Settings {
  /**
   * Whether a LinkedIn job is saved with its posting's text, read from the page you're on when you
   * save it, or with its link and title only. Factwright's own tools never read LinkedIn.
   */
  linkedInText: boolean;
  /**
   * The sync server setup signs in to, as an origin: Factwright's, or a server of your own. Once
   * it's signed in, the extension goes by the server its sign-in is for (src/account.ts), so this
   * is what setup offers, before and after.
   */
  server: string;
}

const DEFAULTS: Settings = { linkedInText: true, server: DEFAULT_SERVER };

/** A saved server, while it's still one this build takes: the stores' build takes https alone. */
function savedServer(saved: unknown): string {
  if (typeof saved !== 'string') return DEFAULTS.server;
  const read = readServer(saved);
  return read.ok ? read.server : DEFAULTS.server;
}

/** Your settings, with the default for any you haven't chosen. */
export async function settings(): Promise<Settings> {
  const { settings: saved } = await ext.storage.local.get('settings');
  const chosen = saved && typeof saved === 'object' ? (saved as Partial<Settings>) : {};
  return { ...DEFAULTS, ...chosen, server: savedServer(chosen.server) };
}

/** Changes some of your settings. */
export async function changeSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...(await settings()), ...changes };
  await ext.storage.local.set({ settings: next });
  return next;
}
