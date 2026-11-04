import { EXTENSION_URL, type JobStatus, type KindName } from '@factwright/core';
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  JOB_STATUS_DISPLAY,
  Select,
  TextArea,
} from '@factwright/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, PostingProblem, PostingRead } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './AddJobDialog.module.css';

/** The statuses a job added by hand can start at. */
const STARTING: readonly JobStatus[] = ['new', 'review', 'apply', 'applied', 'screen', 'interview'];

/** How long typing in the link pauses before Factwright reads it. */
const READ_AFTER_MS = 700;

/** A link Factwright might read: one that starts as a web address does and names a site. */
const looksLikeLink = (text: string) => /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(text);

/** The problems that leave the posting where only a browser, or the user, can get it. */
const IN_A_BROWSER: readonly PostingProblem[] = [
  'linkedin',
  'barred',
  'blocked',
  'browser',
  'unreachable',
  'refused',
];

/** What Add job says when reading the link failed in the app itself, as it never should. */
const NOT_READ: PostingRead = {
  ok: false,
  why: 'unreachable',
  message: 'Factwright couldn’t read the link.',
};

/** What Add job read from the link it has, or is reading. */
interface LinkRead {
  link: string;
  /** Null while it's reading. */
  result: PostingRead | null;
}

/** A number of characters, as "4,692". */
const count = (characters: number) => characters.toLocaleString('en-US');

/** What Add job says of the link it read, or is reading, under it. */
function ReadNote({ read }: { read: LinkRead }) {
  const { result } = read;
  if (!result) {
    return (
      <p className={`${styles.hint} ${styles.wide}`} role="status">
        Reading the posting…
      </p>
    );
  }
  if (result.ok) {
    return (
      <p className={`${styles.read} ${styles.wide}`} role="status">
        Read the posting{result.title ? `: ${result.title}` : ''}, {count(result.characters)}{' '}
        characters. It’s kept with the job.
      </p>
    );
  }
  return (
    <p className={`${styles.unread} ${styles.wide}`} role="status">
      {result.message}{' '}
      {IN_A_BROWSER.includes(result.why) ? (
        <>
          Open the posting in your browser and click{' '}
          <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
            Save to Factwright
          </a>
          , or paste the description below.
        </>
      ) : (
        'If it’s still open, paste its description below.'
      )}
    </p>
  );
}

/**
 * Adds a job the user found on their own. Only the company is needed. A user who wants more than
 * one kind of job puts it under one.
 */
export function AddJobDialog({
  api,
  kinds = [],
  kind: startingKind = null,
  onAdded,
  onClose,
}: {
  api: FactwrightApi;
  /** The kinds of job the user wants, when there's more than one. */
  kinds?: readonly KindName[];
  /** The kind of job it starts under, by id: the one the list shows, if it shows one. */
  kind?: string | null;
  /** Called with the new job's ID, status and kind, so it can be shown. */
  onAdded: (jobId: string, status: JobStatus, kind: string | null) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [link, setLink] = useState('');
  const [pay, setPay] = useState('');
  const [status, setStatus] = useState<JobStatus>('new');
  const hasKinds = kinds.length > 1;
  // None picked leaves it for its fit check to say, as for a job a search found without one.
  const [kind, setKind] = useState(
    kinds.some((each) => each.id === startingKind) ? (startingKind ?? '') : '',
  );
  const [notes, setNotes] = useState('');
  const [posting, setPosting] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What was read from the link, shown under it, and the read still going, for adding to wait on.
  const [read, setRead] = useState<LinkRead | null>(null);
  const reading = useRef<{ link: string; done: Promise<PostingRead> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Reads the link, unless it's being read or was read already, and fills in the company and the
   * role from the posting where the user left them empty. Null for text that isn't a link.
   */
  const readLink = (value: string): Promise<PostingRead> | null => {
    clearTimeout(timer.current);
    const wanted = value.trim();
    if (!looksLikeLink(wanted)) return null;
    if (reading.current?.link === wanted) return reading.current.done;
    const done = api.readPosting(wanted).catch(() => NOT_READ);
    reading.current = { link: wanted, done };
    setRead({ link: wanted, result: null });
    void done.then((result) => {
      if (reading.current?.link !== wanted) return;
      setRead({ link: wanted, result });
      if (!result.ok) return;
      setCompany((typed) => (typed.trim() ? typed : (result.company ?? typed)));
      setRole((typed) => (typed.trim() ? typed : (result.title ?? typed)));
    });
    return done;
  };

  const changeLink = (value: string) => {
    setLink(value);
    clearTimeout(timer.current);
    if (looksLikeLink(value.trim()))
      timer.current = setTimeout(() => readLink(value), READ_AFTER_MS);
  };

  const add = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    setSaving(true);
    // A link still being read, or not read yet, is read before the job is added, so its posting
    // goes with it. One that couldn't be read says why before the job's added without it.
    const shown = read?.link === link.trim() ? read.result : null;
    const result = shown ?? (await readLink(link));
    if (result && !result.ok && !shown && !posting.trim()) {
      setSaving(false);
      return;
    }
    const added = await api.addJob({
      company,
      role,
      link,
      pay,
      status,
      notes,
      ...(posting.trim() && { posting }),
      ...(hasKinds && kind && { kind }),
    });
    setSaving(false);
    if (!added.ok) {
      setProblem(added.message);
      return;
    }
    onAdded(added.jobId, status, (hasKinds && kind) || null);
    close();
  };

  const shownRead = read && read.link === link.trim() ? read : null;

  return (
    <Dialog
      title="Add a job"
      description="For a job you found yourself. Your Claude can check it later."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => add(event, close)}>
          <Field label="Company" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                data-autofocus
                required
                maxLength={LIMITS.company}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            )}
          </Field>
          <Field label="Role" className={hasKinds ? undefined : styles.wide}>
            {(control) => (
              <Input
                {...control}
                maxLength={LIMITS.role}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            )}
          </Field>
          {hasKinds && (
            <Field label="Kind of job">
              {(control) => (
                <Select {...control} value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="">Let its fit check decide</option>
                  {kinds.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Link to the posting" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                type="url"
                placeholder="https://"
                maxLength={LIMITS.link}
                value={link}
                onChange={(event) => changeLink(event.target.value)}
                onBlur={(event) => readLink(event.target.value)}
              />
            )}
          </Field>
          {shownRead && <ReadNote read={shownRead} />}
          <Field label="Job description" className={styles.wide}>
            {(control) => (
              <TextArea
                {...control}
                rows={3}
                placeholder="Paste it here if Factwright can’t read the link"
                maxLength={LIMITS.posting}
                value={posting}
                onChange={(event) => setPosting(event.target.value)}
              />
            )}
          </Field>
          <Field label="Pay, if it’s listed">
            {(control) => (
              <Input
                {...control}
                placeholder="$150k–$180k"
                maxLength={LIMITS.pay}
                value={pay}
                onChange={(event) => setPay(event.target.value)}
              />
            )}
          </Field>
          <Field label="Status">
            {(control) => (
              <Select
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value as JobStatus)}
              >
                {STARTING.map((each) => (
                  <option key={each} value={each}>
                    {JOB_STATUS_DISPLAY[each].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes" className={styles.wide}>
            {(control) => (
              <TextArea
                {...control}
                rows={3}
                maxLength={LIMITS.notes}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>
          <p className={`${styles.hint} ${styles.wide}`}>
            Only the company is needed. Pick Applied if you’ve already sent your application.
          </p>
          <p className={`${styles.hint} ${styles.wide}`}>
            <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
              Our extension for Chrome and Firefox
            </a>{' '}
            saves jobs straight from your browser, with their postings.
          </p>
          {problem && (
            <p className={`${styles.problem} ${styles.wide}`} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.wide}>
            <DialogActions>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving}>
                Add job
              </Button>
            </DialogActions>
          </div>
        </form>
      )}
    </Dialog>
  );
}
