interface Window {
  /** Set by the preload script. Missing when the screens run in a plain browser. */
  factwright?: import('../shared/api.ts').FactwrightApi;
}
