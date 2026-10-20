import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  type FilePlace,
  MAX_PERMISSION_NOTE,
  type PermissionAnswer,
  type PermissionAsk,
  type ProfileChange,
} from '../../shared/permission-asks.ts';
import { canonical } from './questions.ts';
import { TOOLS_SERVER } from './settings.ts';

/** Factwright's own tools that can ask first, by the names Claude Code gives them. */
const OWN = {
  page: `mcp__${TOOLS_SERVER}__read_page`,
  profile: `mcp__${TOOLS_SERVER}__save_about_you`,
  template: `mcp__${TOOLS_SERVER}__save_template`,
};

/** As much of a file's text as the dialog shows in full. Longer, the terminal asks. */
const MAX_SHOWN = 50_000;
const MAX_PATH = 4_096;
const MAX_URL = 4_096;
const MAX_VALUE = 2_000;
const MAX_NAME = 200;

/** What save_about_you can save, in words, in the order the profile shows it. */
const PROFILE_LABELS: Readonly<Record<string, string>> = {
  authorization: 'Work authorization',
  start: 'When you can start',
  relocate: 'Whether you’d move for a job',
  targetPay: 'Base pay you’re aiming for',
  minPay: 'The least base pay you’d take',
  kind: 'The kind of job the pay is for',
  email: 'Email',
  phone: 'Phone',
  location: 'Where you live',
  linkedin: 'LinkedIn',
  website: 'Website',
  interests: 'Interests and hobbies to add',
  learning: 'What you’re learning, to add',
  communities: 'Communities to add',
  cares: 'What you care about',
};

/** What save_about_you adds to a list each, which the dialog shows in a line. */
const PROFILE_LISTS = ['interests', 'learning', 'communities'];

const RELOCATE: Readonly<Record<string, string>> = {
  no: 'No',
  maybe: 'Maybe, for the right one',
  yes: 'Yes',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string within a length, as it came, or null for anything else. */
const textUpTo = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null;

/** The call a permission prompt is for, by its tool and input, as its PostToolUse names it too. */
export function toolKey(tool: unknown, input: unknown): string | null {
  const shown = canonical(input);
  return typeof tool === 'string' && shown !== null ? `${tool}:${shown}` : null;
}

/**
 * What else the dialog's words come from: the run's workspace, which the paths are shown from,
 * and the names of the user's templates, by their IDs.
 */
export interface AskContext {
  workspace?: string;
  templateName?: (id: string) => string | null;
}

/**
 * A file's path, if Claude Code would read it as it reads here: whole, with nothing around it, and
 * not from the home folder's "~", which Claude Code could take one way and the dialog another.
 */
function pathFrom(value: unknown): string | null {
  const path = textUpTo(value, MAX_PATH);
  return path && path === path.trim() && isAbsolute(path) && !path.startsWith('~') ? path : null;
}

/** Where a file is: by its path in the workspace when it's there, or in full when it isn't. */
function placeOf(path: string, workspace: string | undefined): FilePlace & { full: string } {
  const full = resolve(workspace ?? sep, path);
  const inside = workspace ? relative(workspace, full) : '';
  if (workspace && inside && !inside.startsWith('..') && !isAbsolute(inside)) {
    return { file: inside.split(sep).join('/'), outside: false, full };
  }
  return { file: full, outside: true, full };
}

/** What a call to one of Claude Code's own tools, or Factwright's, would do, in the dialog's terms. */
type Described = PermissionAsk extends infer Each
  ? Each extends PermissionAsk
    ? Omit<Each, 'id'>
    : never
  : never;

function describe(
  tool: string,
  input: Record<string, unknown>,
  { workspace, templateName }: AskContext,
): Described | null {
  if (tool === 'Edit') {
    const path = pathFrom(input.file_path);
    const before = textUpTo(input.old_string, MAX_SHOWN);
    const after = textUpTo(input.new_string, MAX_SHOWN);
    const { replace_all: everywhere } = input;
    if (!path || before === null || after === null) return null;
    if (everywhere !== undefined && typeof everywhere !== 'boolean') return null;
    const { file, outside } = placeOf(path, workspace);
    return { kind: 'edit', file, outside, before, after, everywhere: everywhere === true };
  }
  if (tool === 'Write') {
    const path = pathFrom(input.file_path);
    const content = textUpTo(input.content, MAX_SHOWN);
    if (!path || content === null) return null;
    const { file, outside, full } = placeOf(path, workspace);
    return { kind: 'write', file, outside, content, replaces: existsSync(full) };
  }
  if (tool === 'Read') {
    const path = pathFrom(input.file_path);
    if (!path) return null;
    const { file, outside } = placeOf(path, workspace);
    return { kind: 'read', file, outside };
  }
  if (tool === OWN.page || tool === 'WebFetch') {
    const url = textUpTo(input.url, MAX_URL);
    if (!url) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { kind: 'page', url, host: parsed.host };
  }
  if (tool === OWN.profile) {
    const changes: ProfileChange[] = [];
    for (const [key, value] of Object.entries(input)) {
      // Only the fields it saves, never anything a name like "__proto__" could reach.
      const label = Object.hasOwn(PROFILE_LABELS, key) ? PROFILE_LABELS[key] : undefined;
      if (label && PROFILE_LISTS.includes(key)) {
        // A list to add to, shown in a line: one with nothing in it, or not all words, asks there.
        const items = Array.isArray(value) ? value.map((each) => textUpTo(each, MAX_VALUE)) : [];
        if (items.length === 0 || items.some((each) => !each?.trim())) return null;
        const shown = items.map((each) => (each as string).trim()).join(', ');
        if (shown.length > MAX_VALUE) return null;
        changes.push({ label, value: shown });
        continue;
      }
      const text = textUpTo(value, MAX_VALUE);
      if (!label || text === null) return null;
      // A blank clears what's there, which the user sees too.
      if (!text.trim()) {
        changes.push({ label, value: null });
        continue;
      }
      const shown =
        key === 'relocate' ? (Object.hasOwn(RELOCATE, text) ? RELOCATE[text] : undefined) : text;
      if (shown === undefined) return null;
      changes.push({ label, value: shown });
    }
    const order = Object.values(PROFILE_LABELS);
    changes.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    return changes.length > 0 ? { kind: 'profile', changes } : null;
  }
  if (tool === OWN.template) {
    const template = textUpTo(input.id, MAX_NAME);
    const file = input.template;
    const { replace } = input;
    if (!template?.trim() || !isRecord(file)) return null;
    if (replace !== undefined && typeof replace !== 'boolean') return null;
    const name = textUpTo(file.name, MAX_NAME);
    const look = file.look === undefined ? null : textUpTo(file.look, MAX_VALUE);
    const code = JSON.stringify(file, null, 2);
    if (!name?.trim() || (file.look !== undefined && look === null)) return null;
    // The whole file, to look through: longer than the dialog shows, the terminal asks.
    if (code.length > MAX_SHOWN) return null;
    return {
      kind: 'template',
      template,
      name,
      look: look?.trim() || null,
      replace: replace === true,
      replacing: replace === true ? (templateName?.(template) ?? null) : null,
      code,
    };
  }
  return null;
}

/** A permission prompt from a hook, for the dialog, with the call it's for. */
export interface HeardAsk {
  ask: PermissionAsk;
  /** The call it asks about, by its tool and input, which its PostToolUse names too. */
  key: string;
  tool: string;
  input: Record<string, unknown>;
}

/**
 * What a PermissionRequest hook says Claude Code is about to ask the user's OK for, for the app's
 * dialog. Null for any other hook, and for what the dialog leaves to the terminal, as before: a
 * subagent's request, and any tool or input it can't show in full, in plain words. It shows
 * changing, writing or reading a file, reading a web page, and Factwright's tools that save to
 * the user's profile or their templates.
 */
export function permissionAskFrom(event: unknown, context: AskContext = {}): HeardAsk | null {
  if (!isRecord(event) || event.hook_event_name !== 'PermissionRequest') return null;
  if (typeof event.agent_id === 'string' && event.agent_id !== '') return null;
  const tool = event.tool_name;
  const input = event.tool_input;
  if (typeof tool !== 'string' || !isRecord(input)) return null;
  // Without a key, a yes in the terminal couldn't close the dialog, so the terminal asks.
  const key = toolKey(tool, input);
  const described = key === null ? null : describe(tool, input, context);
  if (key === null || !described) return null;
  return { ask: { id: randomUUID(), ...described }, key, tool, input };
}

/** The user's answer from the window, if it's one: allow, or don't allow with a note. */
export function parsePermissionAnswer(value: unknown): PermissionAnswer | null {
  if (!isRecord(value)) return null;
  if (value.allow === true && Object.keys(value).length === 1) return { allow: true };
  const note = textUpTo(value.note, MAX_PERMISSION_NOTE);
  if (value.allow === false && note !== null && Object.keys(value).length === 2) {
    return { allow: false, note };
  }
  return null;
}

/**
 * What the permission hook answers Claude Code with once the user answers in the app's dialog:
 * allow, with the call as Claude asked it and no new rules, or deny, telling Claude the user said
 * no, with anything they added. Claude carries on either way.
 */
export function permissionReply(answer: PermissionAnswer) {
  const note = answer.allow ? '' : answer.note.trim();
  const decision = answer.allow
    ? { behavior: 'allow' }
    : {
        behavior: 'deny',
        message: note
          ? `The user said no, in Factwright, and added: ${note}`
          : 'The user said no, in Factwright.',
      };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}
