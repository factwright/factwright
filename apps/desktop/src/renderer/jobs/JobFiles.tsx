import type { Job, JobDocKind, JobDocs, JobFile } from '@factwright/core';
import { fileSize, shortDate } from '@factwright/core';
import { Button, Dialog, Markdown } from '@factwright/ui';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import styles from './JobPanel.module.css';
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

/** A job's resumes, which open in the user's own app, and its documents, which open here. */
export function FilesSection({ job, api, today }: { job: Job; api: FactwrightApi; today: string }) {
  const [docs, setDocs] = useState<JobDocs | null>(null);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Files</h3>
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
                aria-label={`Open ${file.name}`}
                onClick={() => openFile(file.path)}
              >
                Open
              </Button>
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
    </section>
  );
}
