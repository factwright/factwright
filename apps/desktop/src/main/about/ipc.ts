import { join } from 'node:path';
import { shell } from 'electron';
import { ANSWER_LIMITS, parseAnswerChanges } from '../../shared/about.ts';
import type { EditResult } from '../../shared/api.ts';
import type { AddFileResult } from '../../shared/profile.ts';
import type { TemplatePreviews } from './previews.ts';
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
 * files, the templates' previews, and getting the workspace ready for Claude. Each input is
 * checked here, whatever the window checked first.
 */
export function registerAboutIpc(
  answer: Answer,
  { about, previews }: { about: AboutStore; previews: TemplatePreviews },
): void {
  answer('about:profile', () => about.profile());

  answer('about:save', (changes) => {
    const valid = parseAnswerChanges(changes);
    if (!valid) throw new Error('Refused answers the app doesn’t take.');
    return about.saveAnswers(valid);
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

  answer('about:start', () => about.start());
  answer('about:use-answers', () => about.useAnswersForCriteria());
  answer('about:preview', (layout, name) => previews.preview(layout, name));

  answer('system:open-terminal', async (): Promise<EditResult> => {
    const app = terminalApp(process.platform);
    if (!app) return { ok: false, message: 'Open your terminal app, then run the command there.' };
    const failed = await shell.openPath(app);
    return failed
      ? { ok: false, message: 'Your terminal didn’t open. Open it yourself, then run the command.' }
      : { ok: true };
  });
}
