/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Another sync server to build the extension for, in place of app.factwright.com. */
  readonly VITE_FACTWRIGHT_SYNC_SERVER?: string;
}
