import {
  type Job,
  type JobFile,
  type LetterText,
  letterPlainText,
  letterWordCount,
  readLetterText,
} from '@factwright/core';
import { Button, MarkdownLine } from '@factwright/ui';
import { Copy, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import styles from './CoverLetter.module.css';
import { FileRow } from './JobFiles.tsx';
import panel from './JobPanel.module.css';
import { PanelSection } from './PanelSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';

/** What a letter's files are, in a few words: "PDF and Word". */
function formats(files: readonly JobFile[]): string | null {
  const pdf = files.some((file) => file.format === 'pdf');
  const word = files.some((file) => file.format === 'docx');
  return pdf && word ? 'PDF and Word' : pdf ? 'PDF' : word ? 'Word' : null;
}

/**
 * The job's cover letter, once Claude has written one: the letter to read, its text to copy into
 * an application form with a box for one, and its files to preview, or open and attach.
 */
export function CoverLetterSection({
  job,
  api,
  today,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
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

  // Nothing to show yet: no letter that reads, such as one Claude is still writing, and no files.
  if (!letter && job.letters.length === 0) return null;
  const summary = letter ? `${letterWordCount(letter)} words` : formats(job.letters);

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
    <PanelSection id="letter" title="Cover letter" icon={<Mail size={15} />} summary={summary}>
      {letter && (
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
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
      {preview && <ResumePreview file={preview} api={api} onClose={() => setPreview(null)} />}
    </PanelSection>
  );
}
