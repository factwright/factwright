import { Button, Dialog, DialogActions, VisuallyHidden } from '@factwright/ui';
import { ChevronDown, ChevronUp, FilePen } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  type ChangedFile,
  type ChangeView,
  type DiffLine,
  lineDiff,
  type RunChanges,
  type UndoResult,
} from '../shared/run-changes.ts';
import styles from './TaskChanges.module.css';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

/** What a task changed, in a sentence: "Claude changed 3 files and read 2 pages." */
export function changesWords({
  files,
  pages,
  morePages = 0,
}: Pick<RunChanges, 'files' | 'pages'> & { morePages?: number }): string {
  const read = pages.length + morePages;
  const changed = files.length > 0 ? `changed ${plural(files.length, 'file', 'files')}` : '';
  const reading = read > 0 ? `read ${plural(read, 'page', 'pages')}` : '';
  return `Claude ${[changed, reading].filter(Boolean).join(' and ')}.`;
}

/** A file that isn't text, by what it is, such as "PDF". */
function kindOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'pdf') return 'PDF';
  if (extension === 'docx') return 'Word file';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return 'Picture';
  return 'File';
}

/** How much a file changed, in a few words: "+12 −3", "New · 40 lines" or "New · PDF". */
function amountOf(file: ChangedFile): { text: string; added: number; removed: number } | string {
  const { lines } = file;
  if (file.change === 'gone') return 'Gone since';
  if (!lines) return file.change === 'new' ? `New · ${kindOf(file.path)}` : kindOf(file.path);
  if (file.change === 'new') return `New · ${plural(lines.added, 'line', 'lines')}`;
  return { text: `+${lines.added} −${lines.removed}`, ...lines };
}

/** A page's address without its scheme, to read at a glance, such as "acme.com/careers". */
function pageWords(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    return `${host.replace(/^www\./, '')}${pathname === '/' ? '' : pathname}${search}`;
  } catch {
    return url;
  }
}

/** How many lines both texts have, in a run, before a change shows them: past it, they fold. */
const CONTEXT = 3;

/** A change's lines, with long runs both texts have folded to a line saying how many. */
function shownLines(lines: readonly DiffLine[]): (DiffLine | { kind: 'folded'; count: number })[] {
  const shown: (DiffLine | { kind: 'folded'; count: number })[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== 'same') {
      shown.push(lines[i] as DiffLine);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]?.kind === 'same') end++;
    const run = lines.slice(i, end);
    const head = i === 0 ? 0 : CONTEXT;
    const tail = end === lines.length ? 0 : CONTEXT;
    if (run.length > head + tail + 1) {
      shown.push(...run.slice(0, head));
      shown.push({ kind: 'folded', count: run.length - head - tail });
      shown.push(...run.slice(run.length - tail));
    } else {
      shown.push(...run);
    }
    i = end;
  }
  return shown;
}

/** A file's change, before and after the task, a line at a time. */
function ChangeDialog({
  api,
  runId,
  file,
  onClose,
}: {
  api: Pick<FactwrightApi, 'viewChange'>;
  runId: string;
  file: ChangedFile;
  onClose: () => void;
}) {
  const [view, setView] = useState<ChangeView | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    api.viewChange(runId, file.path).then(
      (seen) => live && setView(seen),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [api, runId, file.path]);
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const lines =
    view && view !== 'loading' ? shownLines(lineDiff(view.before ?? '', view.after ?? '')) : [];
  return (
    <Dialog title={`What changed in ${name}`} description={file.path} size="lg" onClose={onClose}>
      {view === 'loading' ? (
        <p className={styles.dialogNote}>Reading it…</p>
      ) : view === null ? (
        <p className={styles.dialogNote}>
          This file is too long to show here, or isn’t text. Open it from its job’s panel, or from
          your job hunt’s folder.
        </p>
      ) : (
        <>
          <p className={styles.dialogNote}>
            {view.before === null
              ? 'A new file. All of it is what Claude wrote.'
              : view.after === null
                ? 'It’s gone now. This is what it said before Claude’s task.'
                : 'Lines marked − were there before Claude’s task, and lines marked + are there now.'}
          </p>
          <ol className={styles.diff} aria-label={`The change to ${name}, a line at a time`}>
            {lines.map((line, i) =>
              line.kind === 'folded' ? (
                <li key={i} className={styles.folded}>
                  {plural(line.count, 'line', 'lines')} the same
                </li>
              ) : (
                <li
                  key={i}
                  className={
                    line.kind === 'added'
                      ? styles.added
                      : line.kind === 'removed'
                        ? styles.removed
                        : styles.same
                  }
                >
                  <span className={styles.mark} aria-hidden="true">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                  </span>
                  <span className={styles.line}>
                    {line.kind !== 'same' && (
                      <VisuallyHidden>
                        {line.kind === 'added' ? 'Added: ' : 'Taken out: '}
                      </VisuallyHidden>
                    )}
                    {line.text || ' '}
                  </span>
                </li>
              ),
            )}
          </ol>
        </>
      )}
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One changed file: its name and folder, how much changed, and View and Undo. */
function ChangedRow({
  file,
  onView,
  undo,
}: {
  file: ChangedFile;
  onView: () => void;
  undo: (path: string, anyway: boolean) => Promise<UndoResult>;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cut = file.path.lastIndexOf('/');
  const name = file.path.slice(cut + 1);
  const folder = cut > 0 ? file.path.slice(0, cut) : '';
  const amount = amountOf(file);
  const run = async (anyway: boolean) => {
    setBusy(true);
    setProblem(null);
    const result = await undo(file.path, anyway);
    setBusy(false);
    if (result.ok) {
      setAsking(null);
      return;
    }
    if (result.reason === 'since') setAsking(result.message);
    else setProblem(result.message);
  };
  return (
    <li className={styles.row}>
      <div className={styles.file}>
        <span className={styles.name}>{name}</span>
        {folder && <span className={styles.folder}>{folder}</span>}
      </div>
      {file.undone ? (
        <span className={styles.undone}>
          {file.change === 'new' ? 'Undone: in the Trash' : 'Undone'}
        </span>
      ) : (
        <>
          {typeof amount === 'string' ? (
            <span className={styles.amount}>{amount}</span>
          ) : (
            <span className={styles.amount}>
              <span className={styles.plus}>+{amount.added}</span>{' '}
              <span className={styles.minus}>−{amount.removed}</span>
              <VisuallyHidden>
                {` lines: ${amount.added} put in, ${amount.removed} taken out`}
              </VisuallyHidden>
            </span>
          )}
          <span className={styles.actions}>
            {file.lines && (
              <Button size="sm" variant="quiet" onClick={onView} aria-label={`View ${file.path}`}>
                View
              </Button>
            )}
            {file.canUndo ? (
              <Button
                size="sm"
                onClick={() => void run(false)}
                disabled={busy || asking !== null}
                aria-label={`Undo ${file.path}`}
              >
                Undo
              </Button>
            ) : (
              <span className={styles.noCopy}>Too big to keep a copy</span>
            )}
          </span>
        </>
      )}
      {asking && (
        <div className={styles.ask} role="alert">
          <p>{asking}</p>
          <span className={styles.actions}>
            <Button size="sm" variant="primary" onClick={() => void run(true)} disabled={busy}>
              Undo anyway
            </Button>
            <Button size="sm" onClick={() => setAsking(null)} disabled={busy}>
              Keep it
            </Button>
          </span>
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * What Claude's task changed in the job hunt, on its card once it's done: each file it made or
 * changed, with how many lines, View to see it before and after, and Undo to put it back, and the
 * pages it read. Folded, it's a line that says how much.
 */
export function TaskChanges({
  api,
  changes,
  undo,
}: {
  api: Pick<FactwrightApi, 'viewChange'>;
  changes: RunChanges;
  undo: (path: string, anyway: boolean) => Promise<UndoResult>;
}) {
  const [open, setOpen] = useState(true);
  const [viewing, setViewing] = useState<ChangedFile | null>(null);
  const list = useId();
  if (changes.files.length === 0 && changes.pages.length === 0) return null;
  return (
    <section className={styles.changes} aria-label="What Claude changed">
      <div className={styles.summary}>
        <FilePen size={15} aria-hidden="true" className={styles.icon} />
        <p className={styles.words}>{changesWords(changes)}</p>
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={open}
          aria-controls={list}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? 'Hide' : 'Show'}
          {open ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </Button>
      </div>
      <div id={list} className={styles.body} hidden={!open}>
        {changes.files.length > 0 && (
          <ul className={styles.rows} aria-label="Files Claude changed">
            {changes.files.map((file) => (
              <ChangedRow key={file.path} file={file} onView={() => setViewing(file)} undo={undo} />
            ))}
          </ul>
        )}
        {changes.pages.length > 0 && (
          <div className={styles.pages}>
            <h3 className={styles.pagesHeading}>Pages Claude read</h3>
            <ul className={styles.pageList}>
              {changes.pages.map((url) => (
                <li key={url} className={styles.page} title={url}>
                  {pageWords(url)}
                </li>
              ))}
              {changes.morePages > 0 && (
                <li className={styles.page}>and {plural(changes.morePages, 'more', 'more')}</li>
              )}
            </ul>
          </div>
        )}
      </div>
      {viewing && (
        <ChangeDialog
          api={api}
          runId={changes.id}
          file={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}
