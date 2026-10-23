import {
  asksForCoverLetter,
  type Job,
  type JobFile,
  type LetterText,
  letterPlainText,
  letterWordCount,
  readLetterText,
} from '@factwright/core';
import { Button, MarkdownLine } from '@factwright/ui';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { DocVersion } from '../../shared/versions.ts';
import { ClaudeButton, isRunning } from './ClaudeButton.tsx';
import styles from './CoverLetter.module.css';
import { FileRow } from './JobFiles.tsx';
import panel from './JobPanel.module.css';
import { Part, Placeholder } from './PanelSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';
import type { RunControls } from './RunActions.tsx';
import { EarlierVersions, NewVersionButton, RequestChanges, SentPill } from './Versions.tsx';

/** What a letter's files are, in a few words: "PDF and Word". */
function formats(files: readonly JobFile[]): string | null {
  const pdf = files.some((file) => file.format === 'pdf');
  const word = files.some((file) => file.format === 'docx');
  return pdf && word ? 'PDF and Word' : pdf ? 'PDF' : word ? 'Word' : null;
}

/**
 * The job's cover letter, once Claude has written one: the letter to read, its text to copy into
 * an application form with a box for one, and its files to preview, or open and attach. Before
 * there's one, the button that writes it.
 */
export function CoverLetterPart({
  job,
  api,
  today,
  run,
  versions = [],
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
  run: RunControls | undefined;
  /** The job's earlier versions, of which the letter's show under it. */
  versions?: readonly DocVersion[];
}) {
  const [letter, setLetter] = useState<LetterText | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const written = job.docKinds.includes('letter');

  // The letter comes from cover-letter.json, which changes the job list when it's saved.
  useEffect(() => {
    let live = true;
    if (!written) {
      setLetter(null);
      return;
    }
    void api.jobDocs(job.id).then((docs) => {
      if (live) setLetter(readLetterText(docs?.letter));
    });
    return () => {
      live = false;
    };
  }, [api, job, written]);

  const task: RunTask = { skill: 'cover-letter', jobId: job.id };
  // Whether Claude is writing it now, so what shows isn't checked yet.
  const writing = isRunning(run, task);
  // Nothing to show yet: no letter that reads, such as one Claude is still writing, and no files.
  if (!letter && job.letters.length === 0) {
    return (
      <Placeholder
        title="Cover letter"
        action={<ClaudeButton run={run} task={task} label="Write a cover letter" adds />}
      >
        {asksForCoverLetter(job)
          ? 'The posting asks for one. Your Claude writes it for this job from your facts, in your voice.'
          : 'A letter for this job, from your facts, in your voice, for when you want one.'}
      </Placeholder>
    );
  }
  const summary = writing
    ? 'Being written'
    : letter
      ? `${letterWordCount(letter)} words`
      : formats(job.letters);

  const copy = async () => {
    if (!letter) return;
    const result = await api.copyText(letterPlainText(letter));
    setCopied(result.ok);
    setProblem(result.ok ? null : result.message);
    if (result.ok) setTimeout(() => setCopied(false), 2000);
  };
  const open = async (path: string) => {
    const result = await api.openFile(path);
    setProblem(result.ok ? null : result.message);
  };

  return (
    <Part
      title="Cover letter"
      summary={
        <>
          {summary} <SentPill job={job} kind="letter" />
        </>
      }
      actions={
        <>
          <RequestChanges job={job} kind="letter" api={api} run={run} />
          <NewVersionButton job={job} kind="letter" api={api} run={run} onProblem={setProblem} />
        </>
      }
    >
      {writing && (
        <p className={`${panel.quiet} ${styles.writing}`}>
          Your Claude is still writing and checking this letter.
        </p>
      )}
      {letter && (
        <details className={styles.read}>
          <summary>Read the letter</summary>
          <article className={styles.letter} aria-label={`Cover letter for ${job.company}`}>
            {letter.recipient.length > 0 && (
              <p className={styles.to}>To {letter.recipient.join(' · ')}</p>
            )}
            {letter.greeting && <p>{letter.greeting}</p>}
            {letter.paragraphs.map((paragraph, i) => (
              <p key={i}>
                <MarkdownLine text={paragraph} />
              </p>
            ))}
            <p className={styles.sign}>
              {letter.closing}
              {letter.closing && letter.signature && <br />}
              {letter.signature}
            </p>
          </article>
        </details>
      )}
      {letter && (
        <div className={styles.copy}>
          <Button
            size="sm"
            icon={<Copy size={13} aria-hidden="true" />}
            aria-label={copied ? 'Copied' : 'Copy text of the cover letter'}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <span className={styles.hint}>For a form’s cover letter box</span>
          <span className={styles.announce} role="status">
            {copied ? 'Copied the cover letter’s text' : ''}
          </span>
        </div>
      )}
      {job.letters.length > 0 && (
        <ul className={`${panel.files} ${styles.files}`} aria-label="The cover letter’s files">
          {job.letters.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              today={today}
              onPreview={setPreview}
              onOpen={open}
            />
          ))}
        </ul>
      )}
      <EarlierVersions
        job={job}
        kind="letter"
        versions={versions}
        api={api}
        today={today}
        onPreview={setPreview}
        onProblem={setProblem}
      />
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
      {preview && <ResumePreview file={preview} api={api} onClose={() => setPreview(null)} />}
    </Part>
  );
}
