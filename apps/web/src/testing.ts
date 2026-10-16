import type { Job } from '@factwright/core';
import { vi } from 'vitest';
import type { Vault } from './vault.ts';

/** A made-up job, with anything not given left empty. */
export function job(base: Partial<Job> & Pick<Job, 'id' | 'company'>): Job {
  return {
    companyKey: base.id.split('--')[0] ?? base.id,
    role: 'Staff Engineer',
    link: null,
    links: [],
    location: null,
    pay: null,
    source: 'Fit check',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    folder: null,
    stage: 'new',
    firstSeen: '2026-10-01',
    lastActivity: '2026-10-01',
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    letters: [],
    outreach: [],
    status: null,
    statusOn: null,
    backOn: null,
    passReason: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    kind: null,
    manual: false,
    calls: [],
    callDocs: [],
    statusLog: [],
    notes: [],
    docKinds: [],
    ...base,
  };
}

/** A job hunt as the browser opened it, with just these jobs unless given more. */
export const vaultOf = (jobs: Job[], more: Partial<Vault> = {}): Vault => ({
  jobs,
  kinds: [],
  files: new Map(),
  docs: new Map(),
  asked: new Map(),
  rows: { jobs: [], status_log: [], calls: [], notes: [] },
  unreadable: 0,
  pages: new Map(jobs.map((job, index) => [job.id, `pageCode${index + 1}`])),
  ...more,
});

/** A request the stand-in server got. */
export interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

/**
 * Stands in for the sync server, through the page's fetch. Each route answers a method and a
 * path, such as "GET /api/account", with a Response, or with JSON. Anything else gets a 404.
 * Returns every request it gets, in order.
 */
export function fakeServer(routes: Record<string, (request: SeenRequest) => unknown>) {
  const requests: SeenRequest[] = [];
  const answer = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const request: SeenRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init.headers),
    };
    requests.push(request);
    const route = routes[`${request.method} ${request.path}`];
    if (!route) {
      return Response.json(
        { error: 'not-found', message: 'There’s nothing here.' },
        { status: 404 },
      );
    }
    const result = await route(request);
    if (result instanceof Response) return result;
    return result === undefined ? new Response(null, { status: 204 }) : Response.json(result);
  };
  vi.stubGlobal('fetch', vi.fn(answer));
  return requests;
}
