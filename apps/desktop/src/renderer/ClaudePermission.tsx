import { Button, Dialog, DialogActions, TextArea } from '@factwright/ui';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  MAX_PERMISSION_NOTE,
  type PermissionAnswer,
  type PermissionAsk,
} from '../shared/permission-asks.ts';
import styles from './ClaudePermission.module.css';

/** The dialog's title: what Claude wants to do, as a question for the user. */
function titleOf(ask: PermissionAsk): string {
  switch (ask.kind) {
    case 'edit':
      return 'Let Claude change a file?';
    case 'write':
      return ask.replaces ? 'Let Claude replace a file?' : 'Let Claude make a new file?';
    case 'read':
      return ask.outside
        ? 'Let Claude read a file outside your job hunt?'
        : 'Let Claude read a file?';
    case 'page':
      return 'Let Claude read a web page?';
    case 'profile':
      return 'Let Claude save this to your profile?';
    case 'template':
      return ask.replace
        ? `Let Claude change your template “${ask.name}”?`
        : `Let Claude save the template “${ask.name}”?`;
  }
}

/** A file's place, with a warning when it's outside the user's job hunt. */
function FileLine({ file, outside }: { file: string; outside: boolean }) {
  return (
    <>
      <p className={styles.file}>{file}</p>
      {outside && (
        <p className={styles.warning}>
          <TriangleAlert size={14} aria-hidden="true" />
          This file is outside your job hunt folder, elsewhere on your computer.
        </p>
      )}
    </>
  );
}

/** Text Claude would write or replace, as it is, in a box that scrolls, tinted as a change. */
function Text({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  /** Whether it's text a change takes out or puts in. */
  tone?: 'removed' | 'added';
}) {
  return (
    <section className={styles.block} aria-label={label}>
      <h3 className={styles.label}>{label}</h3>
      {text === '' ? (
        <p className={styles.empty}>Nothing</p>
      ) : (
        <pre className={`${styles.text} ${tone ? styles[tone] : ''}`}>{text}</pre>
      )}
    </section>
  );
}

/** What Claude wants to do, in full, as the user decides on it. */
function Details({ ask }: { ask: PermissionAsk }) {
  switch (ask.kind) {
    case 'edit':
      return (
        <>
          <FileLine file={ask.file} outside={ask.outside} />
          <Text
            label={ask.everywhere ? 'It replaces, every place it appears' : 'It replaces'}
            text={ask.before}
            tone="removed"
          />
          <Text label="With" text={ask.after} tone="added" />
        </>
      );
    case 'write':
      return (
        <>
          <FileLine file={ask.file} outside={ask.outside} />
          {ask.replaces && (
            <p className={styles.note}>A file is there already, and this replaces all of it.</p>
          )}
          <Text label="What it writes" text={ask.content} />
        </>
      );
    case 'read':
      return (
        <>
          <FileLine file={ask.file} outside={ask.outside} />
          <p className={styles.note}>
            Claude reads your job hunt’s own files without asking. Check this is a file you want it
            to see.
          </p>
        </>
      );
    case 'page':
      return (
        <>
          <p className={styles.url}>{ask.url}</p>
          <p className={styles.note}>
            Reading it sends the page’s address to <strong>{ask.host}</strong>. A job post could try
            to steer Claude into sending your details to a site in a link, so check it’s an address
            you expect.
          </p>
        </>
      );
    case 'profile':
      return (
        <>
          <dl className={styles.changes}>
            {ask.changes.map((change) => (
              <div key={change.label} className={styles.change}>
                <dt>{change.label}</dt>
                <dd>{change.value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>
            Applications ask for these, and Claude fills them in from your profile. You can change
            them any time in Profile.
          </p>
        </>
      );
    case 'template':
      return (
        <>
          {ask.look && <Text label="Its look" text={ask.look} />}
          <p className={styles.note}>
            {ask.replace
              ? 'Every resume that uses it changes the next time it’s built.'
              : 'It joins your templates, for you to pick for any resume.'}
          </p>
        </>
      );
  }
}

/**
 * Claude Code's permission prompt, in a dialog over the app rather than only in the terminal:
 * what Claude wants to do, in full and in plain words, to allow or not. A no can tell Claude why,
 * and Claude carries on without it. Answer in the terminal leaves it to Claude Code's own prompt,
 * which is there too, behind the dialog; answered there first, the dialog closes. Putting it
 * aside, it waits, with a way back in Claude's panel. It never offers to allow anything for
 * good: what Claude may do without asking stays as the user set it.
 */
export function ClaudePermission({
  api,
  ask,
  about,
  onClose,
}: {
  api: Pick<FactwrightApi, 'answerPermission'>;
  ask: PermissionAsk;
  /** What the run is for, such as "Tailored resume · Acme Robotics", or null for a plain run. */
  about: string | null;
  onClose: () => void;
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reply = async (close: () => void, answer: PermissionAnswer | 'terminal') => {
    setSending(true);
    setProblem(null);
    const result = await api.answerPermission(ask.id, answer).catch(() => ({
      ok: false as const,
      message: 'Your answer didn’t reach Claude Code. Try again.',
    }));
    setSending(false);
    if (result.ok) close();
    else setProblem(result.message);
  };
  return (
    <Dialog
      title={titleOf(ask)}
      description={
        about
          ? `Claude Code asks, as your Claude works on ${about}.`
          : 'Claude Code asks, as your Claude works.'
      }
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <>
          <div className={styles.details}>
            <Details ask={ask} />
          </div>
          {noting ? (
            <TextArea
              className={styles.why}
              aria-label="Note for Claude"
              placeholder="Why not, or what Claude should do instead"
              rows={2}
              maxLength={MAX_PERMISSION_NOTE}
              value={note}
              // The user just asked for the box, to type in it.
              autoFocus
              onChange={(event) => setNote(event.target.value)}
            />
          ) : (
            <button type="button" className={styles.addWhy} onClick={() => setNoting(true)}>
              Tell Claude why not
            </button>
          )}
          <div className={styles.footer}>
            {problem && (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            )}
            <DialogActions>
              <Button
                variant="quiet"
                className={styles.terminal}
                disabled={sending}
                onClick={() => void reply(close, 'terminal')}
              >
                Answer in the terminal
              </Button>
              <Button disabled={sending} onClick={() => void reply(close, { allow: false, note })}>
                Don’t allow
              </Button>
              <Button
                variant="primary"
                disabled={sending}
                onClick={() => void reply(close, { allow: true })}
              >
                Allow
              </Button>
            </DialogActions>
          </div>
        </>
      )}
    </Dialog>
  );
}
