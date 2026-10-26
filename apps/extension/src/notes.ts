import type { AskedJob, SentUndo } from '@factwright/core';
import { jobFrameAt } from './application-sites.ts';
import { ext } from './ext.ts';
import type { FormPlace } from './fill.ts';
import { NOTE } from './frame-size.ts';
import type { NoteSays } from './job-site-messages.ts';
import { keptState } from './kept-state.ts';

/**
 * The small note Factwright puts on a page once it's done something there: "Factwright filled 14
 * fields · 2 need you · Details" once Fill fills the form in place, "Marked applied: … · Undo" once
 * it noticed you submitted the application, or what stopped it. It's the extension's own frame
 * (frame.html), which the page can't read. On a job site you allowed, the script there puts it in a
 * corner of the part of the page that shows, as it does the Fill button. Anywhere else, the page
 * you clicked the extension's button on, its menu item or its shortcut, the background puts it in
 * the window's bottom right corner itself, for a couple of minutes. What it says is kept here, by a
 * token its frame names, in the browser's memory while it runs, as the background may start again
 * meanwhile: one through sync, in the background's own memory alone (kept-state.ts).
 */

/** A note on a page, by the token its frame names. */
export interface Note {
  token: string;
  tabId: number;
  frameId: number;
  says: NoteSays;
  /** When it went on the page. */
  at: number;
  /** The way what it says came, once there was one: through sync, it's kept in memory alone. */
  via?: 'computer' | 'sync';
  /** For a job marked applied: the way it was, and what Undo puts back through sync. */
  applied?: { job: AskedJob; via: 'computer' | 'sync'; undo?: SentUndo };
}

/** The most notes kept: more than are ever on pages at once. */
const MOST_NOTES = 40;

/** How long a note the background put on a page itself stays there, unless you close it first. */
export const PUT_FOR_MS = 2 * 60 * 1000;

const notes = keptState<Note>(
  'notes',
  (note) => note.via === 'sync',
  MOST_NOTES,
  (note) => note.at,
);

/** A note, by its token, as its frame in a tab names it: only that tab's. */
export async function noteFor(tabId: number, token: string): Promise<Note | null> {
  const note = (await notes.all())[token];
  return note && note.tabId === tabId ? note : null;
}

/** A tab's notes, newest first. */
export async function notesOn(tabId: number): Promise<Note[]> {
  return Object.values(await notes.all())
    .filter((note) => note.tabId === tabId)
    .sort((a, b) => b.at - a.at);
}

/** Changes what a note says, as once Undo took its job back. */
export const changeNote = (token: string, says: NoteSays) =>
  notes.change((all) => {
    const note = all[token];
    if (note) all[token] = { ...note, says };
  });

/** Forgets a tab's notes, as the tab closes. */
export const forgetNotes = (tabId: number) =>
  notes.change((all) => {
    for (const [token, note] of Object.entries(all)) if (note.tabId === tabId) delete all[token];
  });

/**
 * Puts a note on a page, in a frame of the extension's own, in the window's bottom right corner,
 * for a while, in place of one it put there before: run in the page, as the background puts one
 * where its script doesn't run. Its shadow root is closed, and its frame's address is the
 * extension's own, so the page can't read it.
 */
export function putNote(token: string, width: number, height: number, ms: number): void {
  const KEY = Symbol.for('factwright note');
  const TOKEN = Symbol.for('factwright note token');
  const own = globalThis as unknown as Record<symbol, HTMLElement | string | undefined>;
  (own[KEY] as HTMLElement | undefined)?.remove();
  own[TOKEN] = token;
  type Api = { runtime: { getURL(path: string): string } };
  const apis = globalThis as unknown as { browser?: Api; chrome?: Api };
  const runtime = (apis.browser ?? apis.chrome)?.runtime;
  if (!runtime) return;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    ':host{all:initial}iframe{display:block;width:100%;height:100%;border:0;margin:0;padding:0;background:transparent;color-scheme:light dark}';
  const frame = document.createElement('iframe');
  frame.title = 'Factwright';
  frame.src = `${runtime.getURL('frame.html')}#note:${token}`;
  root.append(style, frame);
  for (const [name, value] of Object.entries({
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    width: `${width}px`,
    height: `${height}px`,
    'max-width': 'calc(100vw - 32px)',
    'z-index': '2147483647',
    display: 'block',
    margin: '0',
    padding: '0',
    border: '0',
    opacity: '1',
    visibility: 'visible',
    transform: 'none',
    filter: 'none',
    'clip-path': 'none',
    'pointer-events': 'auto',
  })) {
    host.style.setProperty(name, value, 'important');
  }
  document.documentElement.append(host);
  own[KEY] = host;
  setTimeout(() => {
    if (own[KEY] === host) {
      host.remove();
      own[KEY] = undefined;
    }
  }, ms);
}

/** Takes the note the background put on a page away, or only the one a token names: run in the page. */
export function removeNote(token?: string): void {
  const KEY = Symbol.for('factwright note');
  const TOKEN = Symbol.for('factwright note token');
  const own = globalThis as unknown as Record<symbol, HTMLElement | string | undefined>;
  if (token !== undefined && own[TOKEN] !== token) return;
  (own[KEY] as HTMLElement | undefined)?.remove();
  own[KEY] = undefined;
}

/**
 * Shows a note on a page: through the script there, on a job site you allowed, or else put there
 * by the background, which the browser lets it do on a page you clicked its button on. Says its
 * token, which names it, as the popup's Undo does, though the page didn't take it. A note says the
 * way what it says came (`via`), once there was one.
 */
export async function showNote(
  place: FormPlace,
  says: NoteSays,
  more: Pick<Note, 'via' | 'applied'> = {},
): Promise<string> {
  const token = crypto.randomUUID();
  await notes.change((all) => {
    all[token] = {
      token,
      tabId: place.tabId,
      frameId: place.frameId,
      says,
      at: Date.now(),
      ...more,
    };
  });
  const scripted = await jobFrameAt(place.tabId, place.frameId);
  if (scripted) {
    const said = await ext.tabs
      .sendMessage(place.tabId, { type: 'job-site', do: 'note', token }, { frameId: place.frameId })
      .catch(() => null);
    if (said) return token;
  }
  await ext.scripting
    .executeScript({
      target: { tabId: place.tabId, frameIds: [place.frameId] },
      func: putNote,
      args: [token, NOTE.width, NOTE.height, PUT_FOR_MS],
    })
    .catch(() => {
      // A page the browser keeps the extension out of now: the popup says it.
    });
  return token;
}

/** Takes a note off its page, as you close it. */
export async function hideNote(note: Note): Promise<void> {
  const place = { frameId: note.frameId };
  const said = await ext.tabs
    .sendMessage(note.tabId, { type: 'job-site', do: 'unnote', token: note.token }, place)
    .catch(() => null);
  if (said) return;
  await ext.scripting
    .executeScript({ target: { tabId: note.tabId, frameIds: [note.frameId] }, func: removeNote })
    .catch(() => {});
}

/**
 * Takes a note off its page as you close it, where the background doesn't know it anymore, as one
 * that named a job read through sync, once the browser stopped the background meanwhile: the
 * script on a job site you allowed takes away the one its token names, in whichever frame of the
 * tab, and so does the page where the background put it.
 */
export async function hideLostNote(tabId: number, token: string): Promise<void> {
  await ext.tabs.sendMessage(tabId, { type: 'job-site', do: 'unnote', token }).catch(() => null);
  await ext.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: removeNote, args: [token] })
    .catch(() => {
      // A page the browser keeps the extension out of now.
    });
}
