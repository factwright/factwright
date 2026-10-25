import type { Job, JobDocKind, JobDocs, JobFile, SavedPosting } from '@factwright/core';
import { fileSize, shortDate } from '@factwright/core';
import { Button, Dialog, IconButton, Markdown } from '@factwright/ui';
import { Download, FileText, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditResult, FactwrightApi, SaveFileResult } from '../../shared/api.ts';
import styles from './JobPanel.module.css';
import { PanelSection } from './PanelSection.tsx';

/**
 * The documents a job's folder can hold, in the order they're listed, with what each one is.
 * Interview prep is with the job's calls.
 */
const DOCUMENTS: readonly { kind: JobDocKind; name: string; about: string }[] = [
  { kind: 'answers', name: 'Application answers', about: 'Claude’s answers, with why' },
  { kind: 'posting', name: 'Posting', about: 'Saved word for word' },
  { kind: 'fit', name: 'Fit check report', about: 'The full write-up' },
  { kind: 'job', name: 'Job notes', about: 'What Claude noted about the job' },
  { kind: 'unmask', name: 'Employer check', about: 'Who’s really hiring' },
  { kind: 'notes', name: 'Resume notes', about: 'How the resume was tailored' },
];

/** Showing a file where it's kept, in the system's own words: in Finder, on a Mac. */
export const showWords = (platform: string, name?: string) =>
  platform === 'darwin'
    ? `Show ${name ? `${name} ` : ''}in Finder`
    : name
      ? `Show ${name} in its folder`
      : 'Show in folder';

/** What a job's file rows do with a file: open it, save a copy, or show it where it's kept. */
export interface FileActions {
  open: (path: string) => void;
  download: (path: string) => void;
  show: (path: string) => void;
  platform: string;
}

/**
 * What a job's file rows do with its files, saying what went wrong through onProblem: open one in
 * the user's own app for it, save a copy where they pick, or show it where it's kept.
 */
export function fileActions(
  api: Pick<FactwrightApi, 'platform' | 'openFile' | 'downloadFile' | 'showFile'>,
  jobId: string,
  onProblem: (message: string | null) => void,
): FileActions {
  const said = (result: EditResult | SaveFileResult) =>
    onProblem(result.ok ? null : result.message);
  return {
    open: (path) => void api.openFile(path).then(said),
    download: (path) => void api.downloadFile(jobId, path).then(said),
    show: (path) => void api.showFile(jobId, path).then(said),
    platform: api.platform,
  };
}

/**
 * A resume's, cover letter's or Projects page's file: a PDF previews here, and any opens in the
 * user's own app, ready to attach, saves a copy where they pick, or shows where it's kept. A resume
 * can be X-rayed too, to see what an applicant tracking system reads.
 */
export function FileRow({
  file,
  today,
  onPreview,
  actions,
  onXRay,
}: {
  file: JobFile;
  today: string;
  onPreview: (file: JobFile) => void;
  actions: FileActions;
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
          onClick={() => actions.open(file.path)}
        >
          Open
        </Button>
        <IconButton
          size="sm"
          variant="quiet"
          label={`Download ${file.name}`}
          icon={<Download size={14} aria-hidden="true" />}
          onClick={() => actions.download(file.path)}
        />
        <IconButton
          size="sm"
          variant="quiet"
          label={showWords(actions.platform, file.name)}
          icon={<FolderOpen size={14} aria-hidden="true" />}
          onClick={() => actions.show(file.path)}
        />
      </span>
    </li>
  );
}

/**
 * What's saved for a job besides its resumes and letters, to open here: the posting, saved word
 * for word or from the user's browser, the fit check's write-up, and Claude's other notes.
 */
export function SavedSection({ job, api, today }: { job: Job; api: FactwrightApi; today: string }) {
  const [docs, setDocs] = useState<JobDocs | null>(null);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The posting the user saved from their browser with the extension, kept apart from the
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

  // Once Claude saves the posting in the job's folder, that one is shown instead.
  const browserPosting = saved && !job.docKinds.includes('posting') ? saved : null;
  // Older folders keep the posting inside the job notes, unless the browser saved it.
  const documents = DOCUMENTS.filter(({ kind }) => job.docKinds.includes(kind)).map((doc) =>
    doc.kind === 'job' && !job.docKinds.includes('posting') && !browserPosting
      ? { ...doc, name: 'Posting', about: 'Saved with the job notes' }
      : doc,
  );
  const total = documents.length + (browserPosting ? 1 : 0);
  if (total === 0) return null;

  const openDocument = async (kind: JobDocKind, title: string) => {
    const loaded = docs ?? (await api.jobDocs(job.id));
    setDocs(loaded);
    const text = loaded?.[kind];
    setProblem(text ? null : 'That document isn’t in your workspace anymore.');
    if (text) setOpen({ title: `${title}: ${job.company}`, text });
  };

  return (
    <PanelSection
      id="saved"
      title="Saved for this job"
      icon={<FolderOpen size={15} />}
      summary={total === 1 ? '1 document' : `${total} documents`}
      count={total}
      closedAtFirst
    >
      <ul className={styles.files}>
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
    </PanelSection>
  );
}
