import type { Job, JobDocKind, JobDocs, JobFile, SavedPosting } from '@factwright/core';
import { fileSize, shortDate } from '@factwright/core';
import { Button, Dialog, Markdown } from '@factwright/ui';
import { FileText, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { OpenXRay } from '../xray/OpenXRay.tsx';
import styles from './JobPanel.module.css';
import { PanelSection } from './PanelSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';
import { BUSY, type RunControls } from './RunActions.tsx';

/** The documents a job's folder can hold, in the order they're listed, with what each one is. */
const DOCUMENTS: readonly { kind: JobDocKind; name: string; about: string }[] = [
  { kind: 'prep', name: 'Interview prep', about: 'For your calls and interviews' },
  { kind: 'answers', name: 'Application answers', about: 'Answers to the form’s questions' },
  { kind: 'posting', name: 'Posting', about: 'Saved word for word' },
  { kind: 'fit', name: 'Fit check report', about: 'The full write-up' },
  { kind: 'job', name: 'Job notes', about: 'What Claude noted about the job' },
  { kind: 'unmask', name: 'Employer check', about: 'Who’s really hiring' },
  { kind: 'notes', name: 'Resume notes', about: 'How the resume was tailored' },
];

/** A file's name without its extension, which a resume's PDF and Word file share. */
const stem = (name: string) => name.replace(/\.(?:pdf|docx)$/i, '');

/**
 * A resume's or cover letter's file: a PDF previews here, and either opens in the user's own app,
 * ready to attach. A resume can be X-rayed too, to see what an applicant tracking system reads.
 */
export function FileRow({
  file,
  today,
  onPreview,
  onOpen,
  onXRay,
}: {
  file: JobFile;
  today: string;
  onPreview: (file: JobFile) => void;
  onOpen: (path: string) => void;
  /** For a resume: opens its ATS X-ray. A cover letter has none. */
  onXRay?: (file: JobFile) => void;
}) {
  return (
    <li className={styles.file}>
      <FileText className={styles.fileIcon} size={16} aria-hidden="true" />
      <span className={styles.fileText}>
        <span className={styles.fileName}>{file.name}</span>
        <span className={styles.fileMeta}>
          {file.format.toUpperCase()} · {fileSize(file.size)} · {shortDate(file.modified, today)}
        </span>
      </span>
      <span className={styles.fileActions}>
        {file.format === 'pdf' && (
          <Button
            size="sm"
            variant="quiet"
            aria-label={`Preview ${file.name}`}
            onClick={() => onPreview(file)}
          >
            Preview
          </Button>
        )}
        {onXRay && (
          <Button
            size="sm"
            variant="quiet"
            aria-label={`ATS X-ray of ${file.name}`}
            onClick={() => onXRay(file)}
          >
            ATS X-ray
          </Button>
        )}
        <Button
          size="sm"
          variant="quiet"
          aria-label={`Open ${file.name}`}
          onClick={() => onOpen(file.path)}
        >
          Open
        </Button>
      </span>
    </li>
  );
}

/**
 * A job's resumes and cover letters, which open in the user's own app, and its documents, which
 * open here. A resume's X-ray can send what it found for revision, with Claude's panel.
 */
export function FilesSection({
  job,
  api,
  today,
  run,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
  run?: RunControls | undefined;
}) {
  const [docs, setDocs] = useState<JobDocs | null>(null);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [xray, setXray] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The posting the user saved from their browser with Save to Factwright, kept apart from the
  // job's folder, which Claude's work makes.
  const [saved, setSaved] = useState<SavedPosting | null>(null);

  // Read again whenever the job does, such as after a sync, which can bring the posting in.
  useEffect(() => {
    let live = true;
    void api.jobExtras(job.id).then((extras) => {
      if (live) setSaved(extras?.posting ?? null);
    });
    return () => {
      live = false;
    };
  }, [api, job]);

  // The X-ray checks a job's resume against its posting. Older folders keep it in the job notes,
  // and a job saved from the browser may have only the posting the user saved there.
  const posting = useCallback(async () => {
    const loaded = await api.jobDocs(job.id);
    return loaded?.posting ?? saved?.text ?? loaded?.job ?? null;
  }, [api, job.id, saved]);
  /** A resume's PDF and Word file, which share a name, for the X-ray to switch between. */
  const sameResume = (file: JobFile) =>
    job.files.filter((each) => stem(each.name) === stem(file.name));

  // Once Claude saves the posting in the job's folder, that one is shown instead.
  const browserPosting = saved && !job.docKinds.includes('posting') ? saved : null;
  // Older folders keep the posting inside the job notes, unless the browser saved it.
  const documents = DOCUMENTS.filter(({ kind }) => job.docKinds.includes(kind)).map((doc) =>
    doc.kind === 'job' && !job.docKinds.includes('posting') && !browserPosting
      ? { ...doc, name: 'Posting', about: 'Saved with the job notes' }
      : doc,
  );

  const openFile = async (path: string) => {
    const result = await api.openFile(path);
    setProblem(result.ok ? null : result.message);
  };

  const openDocument = async (kind: JobDocKind, title: string) => {
    const loaded = docs ?? (await api.jobDocs(job.id));
    setDocs(loaded);
    const text = loaded?.[kind];
    setProblem(text ? null : 'That document isn’t in your workspace anymore.');
    if (text) setOpen({ title: `${title}: ${job.company}`, text });
  };

  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // A resume or letter built as a PDF and a Word file is one, by its name.
  const named = (files: readonly JobFile[]) =>
    new Set(files.map((file) => file.name.replace(/\.[^.]+$/, ''))).size;
  const built = [...job.files, ...job.letters];
  const summary =
    [
      job.files.length > 0 && count(named(job.files), 'resume'),
      job.letters.length > 0 && count(named(job.letters), 'cover letter'),
      documents.length + (browserPosting ? 1 : 0) > 0 &&
        count(documents.length + (browserPosting ? 1 : 0), 'document'),
    ]
      .filter(Boolean)
      .join(' · ') || 'None yet';

  return (
    <PanelSection id="files" title="Files" icon={<FolderOpen size={15} />} summary={summary}>
      {built.length === 0 && documents.length === 0 && !browserPosting ? (
        <p className={styles.quiet}>No files yet.</p>
      ) : (
        <ul className={styles.files}>
          {job.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              today={today}
              onPreview={setPreview}
              onOpen={openFile}
              onXRay={setXray}
            />
          ))}
          {/* Cover letters have no X-ray: it reads resumes. */}
          {job.letters.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              today={today}
              onPreview={setPreview}
              onOpen={openFile}
            />
          ))}
          {documents.map(({ kind, name, about }) => (
            <li key={kind} className={styles.file}>
              <FileText className={styles.fileIcon} size={16} aria-hidden="true" />
              <span className={styles.fileText}>
                <span className={styles.fileName}>{name}</span>
                <span className={styles.fileMeta}>{about}</span>
              </span>
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Open ${name}`}
                onClick={() => openDocument(kind, name)}
              >
                Open
              </Button>
            </li>
          ))}
          {browserPosting && (
            <li className={styles.file}>
              <FileText className={styles.fileIcon} size={16} aria-hidden="true" />
              <span className={styles.fileText}>
                <span className={styles.fileName}>Posting</span>
                <span className={styles.fileMeta}>
                  Saved from your browser
                  {browserPosting.saved ? `, ${shortDate(browserPosting.saved, today)}` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="quiet"
                aria-label="Open the posting saved from your browser"
                onClick={() =>
                  setOpen({ title: `Posting: ${job.company}`, text: browserPosting.text })
                }
              >
                Open
              </Button>
            </li>
          )}
        </ul>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {open && (
        <Dialog title={open.title} size="lg" onClose={() => setOpen(null)}>
          <Markdown text={open.text} />
        </Dialog>
      )}
      {preview && <ResumePreview file={preview} api={api} onClose={() => setPreview(null)} />}
      {xray && (
        <OpenXRay
          api={api}
          files={sameResume(xray)}
          start={xray.path}
          posting={posting}
          revise={{
            jobId: job.id,
            busy: run ? BUSY.includes(run.phase) : false,
            start: run?.start ?? null,
          }}
          onClose={() => setXray(null)}
        />
      )}
    </PanelSection>
  );
}
