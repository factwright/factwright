import type { Job, JobDocKind, JobDocs, JobFile } from '@factwright/core';
import { fileSize, shortDate } from '@factwright/core';
import { Button, Dialog, Markdown } from '@factwright/ui';
import { FileText, FolderOpen } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { XRayDialog } from '../xray/XRayDialog.tsx';
import styles from './JobPanel.module.css';
import { PanelSection } from './PanelSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';

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

/** A job's resumes, which open in the user's own app, and its documents, which open here. */
export function FilesSection({ job, api, today }: { job: Job; api: FactwrightApi; today: string }) {
  const [docs, setDocs] = useState<JobDocs | null>(null);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [xray, setXray] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The X-ray checks a job's resume against its posting. Older folders keep it in the job notes.
  const posting = useCallback(async () => {
    const loaded = await api.jobDocs(job.id);
    return loaded?.posting ?? loaded?.job ?? null;
  }, [api, job.id]);
  /** A resume's PDF and Word file, which share a name, for the X-ray to switch between. */
  const sameResume = (file: JobFile) =>
    job.files.filter((each) => stem(each.name) === stem(file.name));

  // Older folders keep the posting inside the job notes.
  const documents = DOCUMENTS.filter(({ kind }) => job.docKinds.includes(kind)).map((doc) =>
    doc.kind === 'job' && !job.docKinds.includes('posting')
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
  const summary =
    [
      job.files.length > 0 && count(job.files.length, 'resume'),
      documents.length > 0 && count(documents.length, 'document'),
    ]
      .filter(Boolean)
      .join(' · ') || 'None yet';

  return (
    <PanelSection id="files" title="Files" icon={<FolderOpen size={15} />} summary={summary}>
      {job.files.length === 0 && documents.length === 0 ? (
        <p className={styles.quiet}>No files yet.</p>
      ) : (
        <ul className={styles.files}>
          {job.files.map((file) => (
            <li key={file.path} className={styles.file}>
              <FileText className={styles.fileIcon} size={16} aria-hidden="true" />
              <span className={styles.fileText}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileMeta}>
                  {file.format.toUpperCase()} · {fileSize(file.size)} ·{' '}
                  {shortDate(file.modified, today)}
                </span>
              </span>
              <span className={styles.fileActions}>
                {file.format === 'pdf' && (
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Preview ${file.name}`}
                    onClick={() => setPreview(file)}
                  >
                    Preview
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`ATS X-ray of ${file.name}`}
                  onClick={() => setXray(file)}
                >
                  ATS X-ray
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Open ${file.name}`}
                  onClick={() => openFile(file.path)}
                >
                  Open
                </Button>
              </span>
            </li>
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
        <XRayDialog
          api={api}
          files={sameResume(xray)}
          start={xray.path}
          posting={posting}
          onClose={() => setXray(null)}
        />
      )}
    </PanelSection>
  );
}
