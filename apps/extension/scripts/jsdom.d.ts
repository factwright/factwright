// jsdom ships no types, and the build only needs its window, to run the page reader as a page would.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { url?: string; runScripts?: 'outside-only' });
    readonly window: Window & { eval(code: string): unknown };
  }
}
