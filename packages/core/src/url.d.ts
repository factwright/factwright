/**
 * The parts of the standard URL class that core uses. Every runtime Factwright targets has it
 * (Node, browsers and Cloudflare Workers), but TypeScript's plain ES library doesn't declare it,
 * and core leaves out the Node and DOM types on purpose.
 */
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly host: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly searchParams: URLSearchParams;
}

declare class URLSearchParams {
  get(name: string): string | null;
  keys(): IterableIterator<string>;
  delete(name: string): void;
}
