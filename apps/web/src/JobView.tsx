import {
  applicationAnswers,
  askAnswer,
  CALL_KIND_LABELS,
  CALL_OUTCOME_LABELS,
  callWhen,
  fileSize,
  type Job,
  type JobDocKind,
  jobProgress,
  kindNamed,
  kindOfJob,
  letterPlainText,
  nextStep,
  PASS_REASON_LABELS,
  payLabel,
  questionKey,
  readLetterText,
  readSuggestedAnswers,
  shortDate,
} from '@factwright/core';
import type { AccountKeys } from '@factwright/sync';
import {
  Button,
  Dialog,
  FitBadge,
  JOB_STATUS_DISPLAY,
  Markdown,
  MarkdownLine,
  Notice,
  StatusPill,
} from '@factwright/ui';
import { ArrowLeft, Copy, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import styles from './JobView.module.css';
import { navigate } from './route.ts';
import { client } from './server.ts';
import { fileContents, type Vault } from './vault.ts';

/** The documents a job's folder can hold, in the order the desktop app lists them. */
const DOCUMENTS: readonly { kind: JobDocKind; name: string; about: string }[] = [
  { kind: 'prep', name: 'Interview prep', about: 'For your calls and interviews' },
  { kind: 'answers', name: 'Application answers', about: 'Answers to the form’s questions' },
  { kind: 'posting', name: 'Posting', about: 'Saved word for word' },
  { kind: 'fit', name: 'Fit check report', about: 'The full write-up' },
  { kind: 'job', name: 'Job notes', about: 'What Claude noted about the job' },
  { kind: 'unmask', name: 'Employer check', about: 'Who’s really hiring' },
  { kind: 'notes', name: 'Resume notes', about: 'How the resume was tailored' },
];

const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Everything on file for a job, as the phone shows it. */
export function JobView({
  job,
  vault,
  keys,
  today,
  onSignedOut = () => {},
}: {
  job: Job;
  vault: Vault;
  keys: AccountKeys;
  today: string;
  /** The server said this browser isn't signed in any more. */
  onSignedOut?: () => void;
}) {
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const progress = jobProgress(job, today);
  const next = nextStep(job, progress, today);
  const pay = payLabel(job.pay);
  const docs = vault.docs.get(job.id) ?? {};
  const documents = DOCUMENTS.filter(({ kind }) => docs[kind]);
  const answers = applicationAnswers(job.questions, readSuggestedAnswers(docs.answers), job.sent);
  const letter = readLetterText(docs.letter);
  const built = [...job.files, ...job.letters];
  const asked = vault.asked.get(job.id) ?? {};
  const kind =
    vault.kinds.length > 1
      ? vault.kinds.find((each) => each.id === kindOfJob(job, vault.kinds))
      : undefined;
  // Under the first kind only because nothing has said otherwise yet, as the computer says too.
  const undecided = !(kindNamed(job.kind, vault.kinds) ?? kindNamed(job.kindFound, vault.kinds));

  const openResume = async (path: string, format: 'pdf' | 'docx', name: string) => {
    setProblem(null);
    // Phones only open a tab during the tap itself, so it opens now and shows the PDF once it's ready.
    const tab = format === 'pdf' ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;
    const file = vault.files.get(path);
    let contents: Awaited<ReturnType<typeof fileContents>> | undefined;
    try {
      contents = file && (await fileContents(client, keys, file.id));
    } catch (error) {
      tab?.close();
      if (error instanceof Error && 'kind' in error && error.kind === 'signed-out') onSignedOut();
      else setProblem('That file couldn’t be opened. Try again in a moment.');
      return;
    }
    if (!contents) {
      tab?.close();
      setProblem('That file couldn’t be opened. Try again once your computer has synced.');
      return;
    }
    const url = URL.createObjectURL(new Blob([contents], { type: TYPES[format] }));
    if (tab) tab.location.href = url;
    else {
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // A phone copies only while the tap that asked is still going, and some browsers say no.
  const copyLetter = async () => {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letterPlainText(letter));
      setCopied('copied');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('failed');
    }
  };

  return (
    <article className={styles.job} aria-labelledby="job-title">
      <a
        className={styles.back}
        href="/"
        onClick={(event) => {
          event.preventDefault();
          if (history.length > 1) history.back();
          else navigate('/');
        }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Jobs
      </a>
      <header className={styles.head}>
        <p className={styles.company}>{job.company}</p>
        <h1 id="job-title" className={styles.role}>
          {job.role || 'Role not named yet'}
        </h1>
        <div className={styles.facts}>
          <StatusPill status={progress.status} />
          {(progress.score !== null || progress.tier) && (
            <FitBadge score={progress.score} tier={progress.tier} />
          )}
          {pay && <span>{pay}</span>}
          {job.location && <span>{job.location}</span>}
        </div>
      </header>

      {next && (
        <Notice title="Next step" tone={next.level === 'info' ? 'info' : 'need'}>
          {next.text}
        </Notice>
      )}

      <section className={styles.section} aria-labelledby="tracking">
        <h2 id="tracking" className={styles.heading}>
          Where it stands
        </h2>
        <dl className={styles.list}>
          <div>
            <dt>Status</dt>
            <dd>
              {JOB_STATUS_DISPLAY[progress.status].label}
              {job.statusOn && ` since ${shortDate(job.statusOn, today)}`}
            </dd>
          </div>
          {kind && (
            <div>
              <dt>Kind of job</dt>
              <dd>
                {kind.name}
                {undecided && ', until a fit check'}
              </dd>
            </div>
          )}
          {progress.status === 'later' && job.backOn && (
            <div>
              <dt>Comes back</dt>
              <dd>{shortDate(job.backOn, today)}</dd>
            </div>
          )}
          {progress.status === 'passed' && job.passReason && (
            <div>
              <dt>Why you passed</dt>
              <dd>{PASS_REASON_LABELS[job.passReason]}</dd>
            </div>
          )}
          {job.appliedOn && (
            <div>
              <dt>Applied</dt>
              <dd>{shortDate(job.appliedOn, today)}</dd>
            </div>
          )}
          {job.nextAction && (
            <div>
              <dt>Next step</dt>
              <dd>
                {job.nextAction}
                {job.nextOn && `, by ${shortDate(job.nextOn, today)}`}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {(job.notes.length > 0 || job.earlierNotes) && (
        <section className={styles.section} aria-labelledby="notes">
          <h2 id="notes" className={styles.heading}>
            Your notes
          </h2>
          <ul className={styles.items}>
            {[...job.notes].reverse().map((note) => (
              <li key={note.id}>
                <span className={styles.itemNote}>{shortDate(note.on, today)}</span>
                <p className={styles.notes}>{note.text}</p>
              </li>
            ))}
            {job.earlierNotes && (
              <li>
                <span className={styles.itemNote}>Earlier notes</span>
                <p className={styles.notes}>{job.earlierNotes}</p>
              </li>
            )}
          </ul>
        </section>
      )}

      {job.calls.length > 0 && (
        <section className={styles.section} aria-labelledby="calls">
          <h2 id="calls" className={styles.heading}>
            Calls and interviews
          </h2>
          <ul className={styles.items}>
            {job.calls.map((call) => (
              <li key={call.id}>
                <strong>{CALL_KIND_LABELS[call.kind]}</strong> {callWhen(call, today)}
                {call.outcome && ` · ${CALL_OUTCOME_LABELS[call.outcome]}`}
                {call.notes && <span className={styles.itemNote}>{call.notes}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(letter || job.letters.length > 0) && (
        <section className={styles.section} aria-labelledby="letter">
          <h2 id="letter" className={styles.heading}>
            Cover letter
          </h2>
          {letter && (
            <div className={styles.letter}>
              {letter.recipient.length > 0 && (
                <p className={styles.itemNote}>To {letter.recipient.join(' · ')}</p>
              )}
              {letter.greeting && <p>{letter.greeting}</p>}
              {letter.paragraphs.map((paragraph, i) => (
                <p key={i}>
                  <MarkdownLine text={paragraph} />
                </p>
              ))}
              <p>
                {letter.closing}
                {letter.closing && letter.signature && <br />}
                {letter.signature}
              </p>
            </div>
          )}
          <div className={styles.letterActions}>
            {letter && (
              <Button size="sm" icon={<Copy size={14} aria-hidden="true" />} onClick={copyLetter}>
                {copied === 'copied' ? 'Copied' : 'Copy text'}
              </Button>
            )}
            {job.letters.map((file) => {
              const label = file.format === 'pdf' ? 'Open the PDF' : 'Open the Word file';
              return (
                <Button
                  key={file.path}
                  size="sm"
                  aria-label={`${label}, ${file.name}`}
                  onClick={() => openResume(file.path, file.format, file.name)}
                >
                  {label}
                </Button>
              );
            })}
            <span className={styles.announce} role="status">
              {copied === 'copied' ? 'Copied the cover letter’s text' : ''}
            </span>
          </div>
          {copied === 'failed' && (
            <p className={styles.problem} role="alert">
              This browser wouldn’t copy it. Select the letter’s text and copy that instead.
            </p>
          )}
        </section>
      )}

      {answers.length > 0 && (
        <section className={styles.section} aria-labelledby="answers">
          <h2 id="answers" className={styles.heading}>
            Application answers
          </h2>
          <ul className={styles.items}>
            {answers.map((answer) => (
              <li key={questionKey(answer.question)}>
                <details className={styles.details}>
                  <summary className={styles.summary}>{answer.question}</summary>
                  {answer.sent ? (
                    <>
                      <p className={styles.itemNote}>
                        You sent, {shortDate(answer.sent.on, today)}:
                      </p>
                      <p className={styles.notes}>{answer.sent.text}</p>
                    </>
                  ) : (
                    <p className={styles.itemNote}>What you sent isn’t recorded.</p>
                  )}
                  {answer.suggested && (
                    <>
                      <p className={styles.itemNote}>Claude suggested:</p>
                      <Markdown text={answer.suggested} />
                    </>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.asks.length > 0 && (
        <section className={styles.section} aria-labelledby="asked">
          <h2 id="asked" className={styles.heading}>
            Your questions
          </h2>
          <ul className={styles.items}>
            {[...job.asks].reverse().map((ask) => {
              const answer = asked[ask.id];
              return (
                <li key={ask.id}>
                  <details className={styles.details}>
                    <summary className={styles.summary}>
                      {ask.question}
                      <span className={styles.itemNote}>Asked {shortDate(ask.on, today)}</span>
                    </summary>
                    {answer ? (
                      <Markdown text={askAnswer(answer).body} />
                    ) : (
                      <p className={styles.itemNote}>Claude hasn’t answered this yet.</p>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(built.length > 0 || documents.length > 0) && (
        <section className={styles.section} aria-labelledby="files">
          <h2 id="files" className={styles.heading}>
            Files
          </h2>
          <ul className={styles.items}>
            {built.map((file) => (
              <li key={file.path} className={styles.file}>
                <span>
                  <strong>{file.name}</strong>
                  <span className={styles.itemNote}>
                    {file.format.toUpperCase()} · {fileSize(file.size)} ·{' '}
                    {shortDate(file.modified, today)}
                  </span>
                </span>
                <Button size="sm" onClick={() => openResume(file.path, file.format, file.name)}>
                  Open
                </Button>
              </li>
            ))}
            {documents.map((doc) => (
              <li key={doc.kind} className={styles.file}>
                <span>
                  <strong>{doc.name}</strong>
                  <span className={styles.itemNote}>{doc.about}</span>
                </span>
                <Button
                  size="sm"
                  icon={<FileText size={14} aria-hidden="true" />}
                  onClick={() => setOpen({ title: doc.name, text: docs[doc.kind] ?? '' })}
                >
                  Read
                </Button>
              </li>
            ))}
          </ul>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
        </section>
      )}

      {job.links.length > 0 && (
        <section className={styles.section} aria-labelledby="links">
          <h2 id="links" className={styles.heading}>
            Links
          </h2>
          <ul className={styles.items}>
            {job.links.map((link) => (
              <li key={link.url}>
                <a
                  className={styles.link}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.statusLog.length > 0 && (
        <section className={styles.section} aria-labelledby="history">
          <h2 id="history" className={styles.heading}>
            History
          </h2>
          <ul className={styles.items}>
            {[...job.statusLog].reverse().map((change) => (
              <li key={change.id}>
                {JOB_STATUS_DISPLAY[change.status].label}{' '}
                <span className={styles.itemNote}>{shortDate(change.at, today)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <Dialog title={open.title} size="lg" onClose={() => setOpen(null)}>
          <Markdown text={open.text} />
        </Dialog>
      )}
    </article>
  );
}
