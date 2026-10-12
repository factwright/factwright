import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { localDate } from '@factwright/core';
import type { AboutYou } from '../../shared/about.ts';
import type { ProfileStatus, StartingResume } from '../../shared/profile.ts';
import { untouched } from '../../shared/stamp.ts';

/** Where the about-me files live in the workspace. */
export const ABOUT = {
  answers: 'about-me/answers.json',
  notes: 'about-me/notes.md',
  /** What Claude has read, which it keeps as it goes: "- <path> · <YYYY-MM-DD>" per line. */
  read: 'about-me/read.md',
  criteria: 'searches/criteria.md',
  templates: 'guide/templates.md',
  lint: 'guide/lint.json',
  terms: 'guide/confidential-terms.txt',
  connections: 'linkedin/Connections.csv',
} as const;

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Every Markdown file under a folder, as paths from the workspace. Links are skipped. */
function markdownUnder(workspace: string, folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push(relative(workspace, full).split(sep).join('/'));
      }
    }
  };
  walk(join(workspace, folder));
  return found.sort();
}

/** Files in facts/ that explain the bank or list what's missing, rather than holding claims. */
const NOT_CLAIMS = new Set(['facts/README.md', 'facts/gaps.md']);

/**
 * The claims in the fact bank: each is a "### " heading in facts/, as the skills write them.
 * One whose tags carry `unconfirmed` came from the user's files and waits for them to confirm it.
 */
export function countFacts(workspace: string): ProfileStatus['facts'] {
  let claims = 0;
  let unconfirmed = 0;
  const files = markdownUnder(workspace, 'facts').filter((path) => !NOT_CLAIMS.has(path));
  for (const path of files) {
    const lines = (readText(join(workspace, path)) ?? '').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/^###\s+\S/.test(line)) return;
      claims += 1;
      // The tags sit on the heading's next line that has text.
      const tags = lines.slice(index + 1, index + 4).find((next) => next.trim()) ?? '';
      if (/`unconfirmed`/.test(tags)) unconfirmed += 1;
    });
  }
  return { claims, unconfirmed, files: files.length };
}

/** Whether the user has a fact bank yet. */
export const hasFactBank = (workspace: string) => countFacts(workspace).claims > 0;

/** The starting resumes in base/, with the files built from each. */
export function startingResumes(workspace: string): StartingResume[] {
  let names: string[];
  try {
    names = readdirSync(join(workspace, 'base'))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(readText(join(workspace, 'base', name)) ?? '{}') as Record<string, unknown>;
    } catch {
      // A file that won't parse still shows, so the user can see it's there.
    }
    const output = typeof data.output_name === 'string' ? data.output_name : null;
    const built = (extension: string) => {
      const path = output ? `base/${output}.${extension}` : null;
      return path && isFile(join(workspace, path)) ? path : null;
    };
    return {
      path: `base/${name}`,
      title:
        typeof data.headline === 'string' && data.headline
          ? data.headline
          : name.replace(/\.json$/, ''),
      layout: typeof data.layout === 'string' ? data.layout : 'timeline',
      pdf: built('pdf'),
      docx: built('docx'),
    };
  });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What Claude has read, from its log: each path with the day it read it. */
export function readLog(text: string | null): Map<string, string> {
  const read = new Map<string, string>();
  for (const line of (text ?? '').split(/\r?\n/)) {
    const match = /^-\s+`?([^`·]+?)`?\s+·\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim());
    if (match?.[1] && match[2]) read.set(match[1].trim(), match[2]);
  }
  return read;
}

/** How many people are in a LinkedIn connections export: its rows after the header line. */
function connectionsIn(text: string): number {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => /^"?First Name"?,/i.test(line));
  return header < 0 ? 0 : lines.slice(header + 1).filter((line) => line.trim()).length;
}

/** How far the profile has come, read from the workspace. */
export function profileStatus(workspace: string, answers: AboutYou): ProfileStatus {
  const read = readLog(readText(join(workspace, ABOUT.read)));
  const unread = answers.files.map((file) => file.path).filter((path) => !read.has(path));
  let notesChanged = false;
  try {
    const notes = statSync(join(workspace, ABOUT.notes));
    const readOn = read.get(ABOUT.notes);
    notesChanged = notes.size > 0 && (!readOn || localDate(notes.mtime) > readOn);
  } catch {
    // No notes yet.
  }
  const criteria = readText(join(workspace, ABOUT.criteria));
  const connections = readText(join(workspace, ABOUT.connections));
  const added = answers.files.find((file) => file.kind === 'linkedin-data')?.added ?? '';
  return {
    facts: countFacts(workspace),
    starting: startingResumes(workspace),
    unread,
    notesChanged,
    criteria: criteria === null ? 'none' : untouched(criteria) ? 'app' : 'own',
    connections: connections === null ? null : { count: connectionsIn(connections), added },
  };
}
