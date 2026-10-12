import { localDate } from '@factwright/core';
import { FileDrop, IconButton } from '@factwright/ui';
import { FileSpreadsheet, FileText, Image, X } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import type { AboutYou, FileKind, SharedFile } from '../../../shared/about.ts';
import type { FactwrightApi } from '../../../shared/api.ts';
import { linkedInUpload, readUpload } from '../read-files.ts';
import files from './FilesStep.module.css';
import styles from './steps.module.css';

type FilesApi = Pick<FactwrightApi, 'addFile' | 'addLinkedIn' | 'removeFile'>;

/** The biggest LinkedIn ZIP the window reads. Only its spreadsheets are kept. */
const MAX_ZIP_BYTES = 300 * 1024 * 1024;

/** A picture is a screenshot; anything else among the other files is a document. */
const otherKind = (file: File): FileKind =>
  /\.(png|jpe?g|webp|gif)$/i.test(file.name) ? 'screenshot' : 'document';

/** A file being added: read, then kept, or why it couldn't be. */
interface Adding {
  id: number;
  name: string;
  kind: FileKind;
  problem: string | null;
}

const KIND_ICONS: Readonly<Record<FileKind, ReactNode>> = {
  resume: <FileText size={16} aria-hidden="true" />,
  'linkedin-profile': <FileText size={16} aria-hidden="true" />,
  'linkedin-data': <FileSpreadsheet size={16} aria-hidden="true" />,
  screenshot: <Image size={16} aria-hidden="true" />,
  document: <FileText size={16} aria-hidden="true" />,
};

/** The files of some kinds, kept and on their way, with a way to take each back. */
function FileList({
  kinds,
  kept,
  adding,
  onRemove,
  onDismiss,
}: {
  kinds: readonly FileKind[];
  kept: readonly SharedFile[];
  adding: readonly Adding[];
  onRemove: (file: SharedFile) => void;
  onDismiss: (id: number) => void;
}) {
  const shown = kept.filter((file) => kinds.includes(file.kind));
  const waiting = adding.filter((file) => kinds.includes(file.kind));
  if (shown.length === 0 && waiting.length === 0) return null;
  return (
    <ul className={files.list}>
      {shown.map((file) => (
        <li key={file.path} className={files.row}>
          {KIND_ICONS[file.kind]}
          <span className={files.name}>{file.name}</span>
          <span className={files.state}>Added</span>
          <IconButton
            label={`Remove ${file.name}`}
            variant="quiet"
            size="sm"
            icon={<X size={14} aria-hidden="true" />}
            onClick={() => onRemove(file)}
          />
        </li>
      ))}
      {waiting.map((file) => (
        <li key={file.id} className={files.row}>
          {KIND_ICONS[file.kind]}
          <span className={files.name}>{file.name}</span>
          {file.problem ? (
            <>
              <span className={files.problem} role="alert">
                {file.problem}
              </span>
              <IconButton
                label={`Dismiss ${file.name}`}
                variant="quiet"
                size="sm"
                icon={<X size={14} aria-hidden="true" />}
                onClick={() => onDismiss(file.id)}
              />
            </>
          ) : (
            <span className={files.state} role="status">
              Adding…
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything the user has on paper: resumes, their LinkedIn profile, and screenshots and other
 * documents. The window reads each file's text, and the app keeps it in the workspace for
 * Claude. LinkedIn is shared through files the user saves themselves, never a sign-in.
 */
export function FilesStep({
  answers,
  api,
  onChanged,
}: {
  answers: Pick<AboutYou, 'files'>;
  api: FilesApi;
  /** Called once files were added or removed, with the answers as they are then, if known. */
  onChanged: (answers?: AboutYou) => void;
}) {
  const titleId = useId();
  const [adding, setAdding] = useState<Adding[]>([]);
  const nextId = useRef(0);

  const track = (name: string, kind: FileKind) => {
    const entry = { id: nextId.current++, name, kind, problem: null };
    setAdding((current) => [...current, entry]);
    const settle = (problem: string | null) =>
      setAdding((current) =>
        problem
          ? current.map((each) => (each.id === entry.id ? { ...each, problem } : each))
          : current.filter((each) => each.id !== entry.id),
      );
    return settle;
  };

  const add = (kindOf: FileKind | ((file: File) => FileKind)) => async (chosen: File[]) => {
    await Promise.all(
      chosen.map(async (file) => {
        const kind = typeof kindOf === 'function' ? kindOf(file) : kindOf;
        const settle = track(file.name, kind);
        try {
          const result = await api.addFile(await readUpload(file, kind));
          settle(result.ok ? null : result.message);
        } catch {
          settle('That file couldn’t be read. Try saving it again.');
        }
      }),
    );
    onChanged();
  };

  const addLinkedInData = async ([zip]: File[]) => {
    if (!zip) return;
    const settle = track(zip.name, 'linkedin-data');
    try {
      if (zip.size > MAX_ZIP_BYTES) {
        settle('That ZIP is too big. Ask LinkedIn for the smaller copy of your data.');
        return;
      }
      const upload = linkedInUpload(new Uint8Array(await zip.arrayBuffer()), localDate());
      const result = await api.addLinkedIn(upload);
      settle(result.ok ? null : result.message);
    } catch {
      settle('That ZIP doesn’t hold LinkedIn data. Use the ZIP LinkedIn emailed you a link to.');
    }
    onChanged();
  };

  const remove = async (file: SharedFile) => onChanged(await api.removeFile(file.path));
  const dismiss = (id: number) => setAdding((current) => current.filter((each) => each.id !== id));
  const list = (kinds: readonly FileKind[]) => (
    <FileList
      kinds={kinds}
      kept={answers.files}
      adding={adding}
      onRemove={remove}
      onDismiss={dismiss}
    />
  );

  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Your resumes and profile
        </h2>
        <p className={styles.lead}>
          Add everything you have. Each old resume, your LinkedIn profile and a few screenshots can
          each hold details the others don’t, and the more Claude reads, the fewer questions it
          asks.
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Resumes</h3>
        <FileDrop
          title="Drop your resumes here"
          hint="PDF or Word. Add every version you have, even old ones."
          buttonLabel="Choose resumes"
          accept=".pdf,.docx,.txt,.md"
          onFiles={(chosen) => void add('resume')(chosen)}
        />
        {list(['resume'])}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>LinkedIn</h3>
        <p className={styles.sectionLead}>
          Factwright never signs in to LinkedIn for you: LinkedIn doesn’t allow apps to read
          profiles, and trying could get your account restricted. Share it either of these ways
          instead.
        </p>
        <div className={files.pair}>
          <div className={files.way}>
            <h4 className={files.wayTitle}>Your profile as a PDF</h4>
            <p className={styles.note}>
              On LinkedIn, open your profile, choose <strong>Resources</strong> (or{' '}
              <strong>More</strong>), then <strong>Save to PDF</strong>.
            </p>
            <FileDrop
              title="Drop the PDF here"
              buttonLabel="Choose the PDF"
              accept=".pdf"
              multiple={false}
              onFiles={(chosen) => void add('linkedin-profile')(chosen)}
            />
          </div>
          <div className={files.way}>
            <h4 className={files.wayTitle}>All your LinkedIn data</h4>
            <p className={styles.note}>
              In LinkedIn’s <strong>Settings &amp; Privacy</strong>, choose{' '}
              <strong>Data privacy</strong>, then <strong>Get a copy of your data</strong>. LinkedIn
              emails you a link, often within minutes. It brings your connections too, which help
              Claude find people to message.
            </p>
            <FileDrop
              title="Drop the ZIP here"
              buttonLabel="Choose the ZIP"
              accept=".zip"
              multiple={false}
              onFiles={(chosen) => void addLinkedInData(chosen)}
            />
          </div>
        </div>
        {list(['linkedin-profile', 'linkedin-data'])}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Screenshots and other files</h3>
        <FileDrop
          title="Drop screenshots or documents here"
          hint="Screenshots of your LinkedIn, performance reviews, award letters, project write-ups, portfolio pieces: anything that shows what you’ve done."
          buttonLabel="Choose files"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md"
          onFiles={(chosen) => void add(otherKind)(chosen)}
        />
        {list(['screenshot', 'document'])}
      </div>
    </section>
  );
}
