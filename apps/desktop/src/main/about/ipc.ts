import { join } from 'node:path';
import { readHistory } from '@factwright/core';
import { shell } from 'electron';
import { ANSWER_LIMITS, parseAnswerChanges } from '../../shared/about.ts';
import type { EditResult } from '../../shared/api.ts';
import {
  parseFactChange,
  parseFactTarget,
  parseGapTarget,
  parseNewFact,
} from '../../shared/facts.ts';
import { parsePrivateChanges } from '../../shared/private.ts';
import type { AddFileResult } from '../../shared/profile.ts';
import type { TemplateLibrary } from '../resume/templates.ts';
import { contactFromResume } from './from-resume.ts';
import type { TemplatePreviews } from './previews.ts';
import type { PrivateAnswers } from './private.ts';
import type { AboutStore } from './store.ts';
import { checkLinkedIn, checkUpload } from './uploads.ts';

/** Registers one checked request from the window, as ipc.ts does for the rest. */
type Answer = (channel: string, reply: (...args: unknown[]) => unknown) => void;

const REFUSED: EditResult = { ok: false, message: 'That couldn’t be saved.' };

/** The system's own terminal app, where the user runs Claude Code's commands themselves. */
function terminalApp(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return '/System/Applications/Utilities/Terminal.app';
  if (platform === 'win32') {
    return join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
  }
  return null;
}

/**
 * The window's requests about the user: their answers, notes, confidential names and shared
 * files, their fact bank, their templates and the templates' previews, and getting the workspace
 * ready for Claude. Each input is checked here, whatever the window checked first.
 */
export function registerAboutIpc(
  answer: Answer,
  {
    about,
    previews,
    templates,
    kept,
    workspace,
  }: {
    about: AboutStore;
    previews: TemplatePreviews;
    templates: TemplateLibrary;
    /** What Profile keeps for applications on this computer alone. */
    kept: PrivateAnswers;
    /** The open profile's workspace, where the resumes Factwright made are. */
    workspace: string;
  },
): void {
  answer('about:profile', () => about.profile());

  answer('about:save', (changes) => {
    const valid = parseAnswerChanges(changes);
    if (!valid) throw new Error('Refused answers the app doesn’t take.');
    return about.saveAnswers(valid);
  });

  answer('about:private', () => kept.read());

  answer('about:from-resume', () => contactFromResume(workspace));

  // The work history as the window changed it, checked as the file is read.
  answer('about:save-history', (history) => {
    if (typeof history !== 'object' || history === null || Array.isArray(history)) {
      throw new Error('Refused a work history the app doesn’t take.');
    }
    return about.saveHistory(readHistory(history));
  });

  answer('about:save-private', (changes) => {
    const valid = parsePrivateChanges(changes);
    if (!valid) throw new Error('Refused answers the app doesn’t take.');
    return kept.save(valid);
  });

  answer('about:notes', (text): EditResult => {
    if (typeof text !== 'string' || text.length > ANSWER_LIMITS.notes) return REFUSED;
    about.saveNotes(text);
    return { ok: true };
  });

  answer('about:confidential', (changes) => {
    const names = (value: unknown): value is string[] =>
      Array.isArray(value) &&
      value.length <= 500 &&
      value.every((name) => typeof name === 'string' && name.length <= ANSWER_LIMITS.entry);
    const { add, remove } = (changes ?? {}) as Record<string, unknown>;
    if (!names(add) || !names(remove)) throw new Error('Refused names the app doesn’t take.');
    return about.changeConfidential({ add, remove });
  });

  answer('about:add-file', (upload): AddFileResult => {
    const checked = checkUpload(upload);
    return 'problem' in checked ? { ok: false, message: checked.problem } : about.addFile(checked);
  });

  answer('about:add-linkedin', (upload): AddFileResult => {
    const checked = checkLinkedIn(upload);
    return checked
      ? about.addLinkedIn(checked)
      : {
          ok: false,
          message: 'That LinkedIn file couldn’t be read. Try the ZIP LinkedIn sent you.',
        };
  });

  answer('about:remove-file', (path) => {
    if (typeof path !== 'string' || path.length > 300) throw new Error('Refused a file to remove.');
    return about.removeFile(path);
  });

  // The fact bank, a block at a time, each checked against the file as it is now.
  answer('facts:read', () => about.facts.read());
  answer('facts:change', (change) => {
    const valid = parseFactChange(change);
    return valid ? about.facts.change(valid) : REFUSED;
  });
  answer('facts:add', (fact) => {
    const valid = parseNewFact(fact);
    return valid ? about.facts.add(valid) : REFUSED;
  });
  answer('facts:remove', (target) => {
    const valid = parseFactTarget(target);
    return valid ? about.facts.remove(valid) : REFUSED;
  });
  answer('facts:confirm', (target) => {
    const valid = parseFactTarget(target);
    return valid ? about.facts.confirm(valid) : REFUSED;
  });
  answer('facts:remove-gap', (target) => {
    const valid = parseGapTarget(target);
    return valid ? about.facts.removeGap(valid) : REFUSED;
  });

  answer('about:start', () => about.start());
  answer('about:use-answers', () => about.useAnswersForCriteria());
  answer('about:preview', (id, name) => previews.preview(id, name));

  answer('templates:add', (upload) => templates.add(upload));

  // A template that's gone can't be picked, so it leaves the user's picks too.
  answer('templates:remove', async (id): Promise<EditResult> => {
    const removed = await templates.remove(id);
    const { looks } = about.answers();
    if (removed.ok && looks.some((look) => look.layout === id)) {
      about.saveAnswers({ looks: looks.filter((look) => look.layout !== id) });
    }
    return removed;
  });

  answer('system:open-terminal', async (): Promise<EditResult> => {
    const app = terminalApp(process.platform);
    if (!app) return { ok: false, message: 'Open your terminal app, then run the command there.' };
    const failed = await shell.openPath(app);
    return failed
      ? { ok: false, message: 'Your terminal didn’t open. Open it yourself, then run the command.' }
      : { ok: true };
  });
}
