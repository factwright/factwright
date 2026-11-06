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
  VisuallyHidden,
} from '@factwright/ui';
import { Check, Circle } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi, PostingProblem, PostingRead } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './AddJobDialog.module.css';
import { postingParts, WHOLE_POSTING } from './posting-parts.ts';

/** The statuses a job added by hand can start at. */
const STARTING: readonly JobStatus[] = ['new', 'review', 'apply', 'applied', 'screen', 'interview'];

/** How long typing in the link pauses before Factwright reads it. */
const READ_AFTER_MS = 700;

/** A link Factwright might read: one that starts as a web address does and names a site. */
const looksLikeLink = (text: string) => /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(text);

/** What works instead, for each problem: the browser, or pasting. */
const INSTEAD: Readonly<Record<PostingProblem, 'browser' | 'open' | 'own-link' | 'file'>> = {
  linkedin: 'browser',
  barred: 'browser',
  blocked: 'browser',
  browser: 'browser',
  unreachable: 'browser',
  refused: 'browser',
  gone: 'open',
  closed: 'open',
  list: 'own-link',
  file: 'file',
};

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

/** A link it couldn't read, and why. */
type Unread = Extract<PostingRead, { ok: false }>;

/** A number of characters, as "4,692". */
const count = (characters: number) => characters.toLocaleString('en-US');

/** The extension's page, as a link. */
function ExtensionLink() {
  return (
    <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
      Save to Factwright
    </a>
  );
}

/** What Add job says of the link it read, or is reading, under it, with Try again when it may work. */
function ReadNote({ read, onAgain }: { read: LinkRead; onAgain: () => void }) {
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
  const instead = INSTEAD[result.why];
  return (
    <p className={`${styles.unread} ${styles.wide}`} role="status">
      {result.message}{' '}
      {result.why === 'unreachable' && (
        <>
          <Button size="sm" variant="quiet" onClick={onAgain}>
            Try again
          </Button>{' '}
        </>
      )}
      {instead === 'browser' && (
        <>
          Open the posting in your browser and click <ExtensionLink />, or paste the description
          below.
        </>
      )}
      {instead === 'open' && 'If it’s still open, paste its description below.'}
      {instead === 'own-link' && 'Use the job’s own link, or paste its description below.'}
      {instead === 'file' && 'Open it, and paste the description below.'}
    </p>
  );
}

/** What works for a link it couldn't read, said at the top of the step that asks for the posting. */
function WhatWorks({ unread }: { unread: Unread }) {
  switch (INSTEAD[unread.why]) {
    case 'browser':
      return (
        <>
          Paste the posting below. Or open it in your browser and click <ExtensionLink />, which
          saves the whole posting with its link in one click.
        </>
      );
    case 'open':
      return <>If you still have the posting, paste it below.</>;
    case 'own-link':
      return <>Go back and use the job’s own link, or paste its posting below.</>;
    case 'file':
      return <>Open the file, and paste the posting below.</>;
  }
}

/**
 * Adds a job the user found on their own. Only the company is needed. A user who wants more than
 * one kind of job puts it under one. When Factwright can't read the job's link, and nothing was
 * pasted for it, the dialog turns to asking for the posting, plainly, with a big box to paste it
 * in and what to paste, so the user's Claude has what it needs to analyze the job.
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
  // Whether it shows the details, or asks for the posting of a link it couldn't read.
  const [step, setStep] = useState<'details' | 'paste'>('details');
  // What was read from the link, shown under it, and the read still going, for adding to wait on.
  const [read, setRead] = useState<LinkRead | null>(null);
  const reading = useRef<{ link: string; done: Promise<PostingRead> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // What's pasted for the posting as the read ends, which says whether to ask for it.
  const pasted = useRef(posting);
  useEffect(() => {
    pasted.current = posting;
  }, [posting]);
  const companyBox = useRef<HTMLInputElement>(null);
  const linkBox = useRef<HTMLInputElement>(null);
  const postingBox = useRef<HTMLTextAreaElement>(null);
  const partsId = useId();

  /**
   * Reads the link, unless it's being read or was read already, and fills in the company and the
   * role from the posting where the user left them empty. One it can't read asks for its posting,
   * unless the user pasted it already. Null for text that isn't a link.
   */
  const readLink = (value: string, again = false): Promise<PostingRead> | null => {
    clearTimeout(timer.current);
    const wanted = value.trim();
    if (!looksLikeLink(wanted)) return null;
    if (reading.current?.link === wanted && !again) return reading.current.done;
    const done = api.readPosting(wanted).catch(() => NOT_READ);
    reading.current = { link: wanted, done };
    setRead({ link: wanted, result: null });
    void done.then((result) => {
      if (reading.current?.link !== wanted) return;
      setRead({ link: wanted, result });
      if (!result.ok) {
        if (!pasted.current.trim()) setStep('paste');
        return;
      }
      setStep('details');
      setCompany((typed) => (typed.trim() ? typed : (result.company ?? typed)));
      setRole((typed) => (typed.trim() ? typed : (result.title ?? typed)));
    });
    return done;
  };

  const changeLink = (value: string) => {
    setLink(value);
    clearTimeout(timer.current);
    // What a read of the link before says is about that link alone, so it fills in nothing now.
    if (reading.current && reading.current.link !== value.trim()) reading.current = null;
    if (looksLikeLink(value.trim())) {
      timer.current = setTimeout(() => readLink(value), READ_AFTER_MS);
    }
  };

  // What was read from the link the dialog has, or is being read from it.
  const shownRead = read && read.link === link.trim() ? read : null;
  // While the link is read, the job waits for it, unless the user pasted its posting.
  const waiting = Boolean(shownRead && !shownRead.result) && !posting.trim();
  // The link it couldn't read, if that's what it has.
  const unread = shownRead?.result && !shownRead.result.ok ? shownRead.result : null;
  const asking = step === 'paste' && unread !== null;

  // Asked for the posting, the box for it takes the keyboard, ready to paste. Back from there, the
  // link does, as going back is for changing it.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) postingBox.current?.focus();
    else if (wasAsking.current) linkBox.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  /**
   * Adds the job. A link not read yet, or still being read, is read first, and the next click adds
   * the job, with its posting, or once the dialog has asked for it, so nothing it reads after a
   * click changes the job the click added. Text the user pasted needs no reading. A job whose link
   * can't be read is added without its posting only when the user says so.
   */
  const add = async (close: () => void, withoutPosting = false) => {
    setProblem(null);
    const pastedNow = posting.trim();
    if (!pastedNow && looksLikeLink(link.trim()) && !shownRead?.result) {
      readLink(link);
      return;
    }
    if (unread && !pastedNow && !withoutPosting) {
      if (asking) {
        setProblem('Paste the job’s posting first, or choose Add without the posting.');
        postingBox.current?.focus();
      } else {
        setStep('paste');
      }
      return;
    }
    if (!company.trim()) {
      setProblem('Add the company’s name first.');
      companyBox.current?.focus();
      return;
    }
    setSaving(true);
    const added = await api.addJob({
      company,
      role,
      link,
      pay,
      status,
      notes,
      ...(pastedNow && { posting }),
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
  const submit = (close: () => void) => (event: FormEvent) => {
    event.preventDefault();
    void add(close);
  };

  const companyField = (
    <Field label="Company" className={asking ? undefined : styles.wide}>
      {(control) => (
        <Input
          {...control}
          ref={companyBox}
          data-autofocus
          required
          maxLength={LIMITS.company}
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
      )}
    </Field>
  );
  const roleField = (
    <Field label="Role" className={hasKinds || asking ? undefined : styles.wide}>
      {(control) => (
        <Input
          {...control}
          maxLength={LIMITS.role}
          value={role}
          onChange={(event) => setRole(event.target.value)}
        />
      )}
    </Field>
  );
  const kindField = hasKinds && (
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
  );
  const payField = (
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
  );
  const problemNote = problem && (
    <p className={`${styles.problem} ${styles.wide}`} role="alert">
      {problem}
    </p>
  );

  if (asking) {
    const parts = postingParts(posting);
    const length = posting.trim().length;
    return (
      <Dialog
        title="Paste the posting"
        description="Factwright can’t read that link, so your Claude has nothing to analyze yet. Paste the job’s posting here, and it can."
        size="xl"
        onClose={onClose}
      >
        {(close) => (
          <form className={styles.paste} onSubmit={submit(close)}>
            <div className={styles.why} role="status">
              <p className={styles.whyLine}>{unread.message}</p>
              <p className={styles.whyLine}>
                <WhatWorks unread={unread} />
              </p>
              {unread.why === 'unreachable' && (
                <div>
                  <Button size="sm" onClick={() => readLink(link, true)}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
            <div className={styles.details}>
              {companyField}
              {roleField}
              {kindField}
              {payField}
            </div>
            <div className={styles.pasteArea}>
              <Field label="Job posting" className={styles.postingField}>
                {(control) => (
                  <TextArea
                    {...control}
                    ref={postingBox}
                    rows={16}
                    className={styles.postingBox}
                    placeholder="Paste the whole posting here, from the job’s title down to the end."
                    maxLength={LIMITS.posting}
                    value={posting}
                    onChange={(event) => setPosting(event.target.value)}
                  />
                )}
              </Field>
              <section className={styles.parts} aria-labelledby={partsId}>
                <h3 id={partsId} className={styles.partsTitle}>
                  What to paste
                </h3>
                <p className={styles.hint}>
                  Your Claude scores the job on these, so the more of them it has, the better it can
                  say how well you fit.
                </p>
                <ul className={styles.partList}>
                  {parts.map((part) => (
                    <li key={part.id} className={part.found ? styles.found : styles.missing}>
                      {part.found ? (
                        <Check size={15} aria-hidden="true" className={styles.partIcon} />
                      ) : (
                        <Circle size={15} aria-hidden="true" className={styles.partIcon} />
                      )}
                      <span>
                        {part.label}
                        {part.found && <VisuallyHidden>: it’s there</VisuallyHidden>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={styles.hint}>
                  {unread.why === 'linkedin'
                    ? 'On LinkedIn, click “… more” under About the job first, so all of it shows. Then select from the job’s title down to the end, and copy.'
                    : 'On the posting’s page, select from the job’s title down to the end, and copy.'}
                </p>
              </section>
            </div>
            {length > 0 && (
              <p className={length < WHOLE_POSTING ? styles.short : styles.hint}>
                {count(length)} characters.
                {length < WHOLE_POSTING &&
                  ' That may be only part of the posting: paste all of it, from the top.'}
              </p>
            )}
            {problemNote}
            <DialogActions>
              <Button
                onClick={() => {
                  setProblem(null);
                  setStep('details');
                }}
              >
                Back
              </Button>
              <Button variant="quiet" disabled={saving} onClick={() => void add(close, true)}>
                Add without the posting
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                Add job
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Add a job"
      description="For a job you found yourself. Your Claude can check it later."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={submit(close)}>
          {companyField}
          {roleField}
          {kindField}
          <Field label="Link to the posting" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                ref={linkBox}
                type="url"
                placeholder="https://"
                maxLength={LIMITS.link}
                value={link}
                onChange={(event) => changeLink(event.target.value)}
                onBlur={(event) => readLink(event.target.value)}
              />
            )}
          </Field>
          {shownRead && <ReadNote read={shownRead} onAgain={() => readLink(link, true)} />}
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
          {payField}
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
          {problemNote}
          <div className={styles.wide}>
            <DialogActions>
              <Button onClick={close}>Cancel</Button>
              <Button
                variant="primary"
                type="submit"
                disabled={saving}
                aria-disabled={waiting || undefined}
              >
                Add job
              </Button>
            </DialogActions>
          </div>
        </form>
      )}
    </Dialog>
  );
}
