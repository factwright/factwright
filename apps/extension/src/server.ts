/**
 * Where the extension syncs: Factwright's sync server, the only site it may reach. A build can
 * point it at another, such as one running locally or someone's own, with
 * VITE_FACTWRIGHT_SYNC_SERVER, as the desktop app's builds can.
 */
export const SYNC_ORIGIN: string = new URL(
  import.meta.env.VITE_FACTWRIGHT_SYNC_SERVER || 'https://app.factwright.com',
).origin;
