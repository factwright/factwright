import { Button, Dialog, DialogActions, SegmentedControl, VisuallyHidden } from '@factwright/ui';
import { type CheckId, SECTION_NAMES, textMarks, type XRay, type XRayLine } from '@factwright/xray';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { useXRay, type XRayFile } from './useXRay.ts';
import styles from './XRay.module.css';
import { ChecksView, FieldsView, KeywordsView } from './XRayReport.tsx';

type Tab = 'checks' | 'keywords' | 'fields';

/** A line's text, with what the checks find in it marked: unreadable, joined or spaced letters. */
function MarkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mark of textMarks(text)) {
    if (mark.start < at) continue;
    parts.push(text.slice(at, mark.start));
    const piece = text.slice(mark.start, mark.end);
    parts.push(
      mark.kind === 'junk' ? (
        <span
          key={mark.start}
          className={styles.junk}
          role="img"
          aria-label="a character systems can’t read"
        >
          ?
        </span>
      ) : (
        <mark key={mark.start} className={styles[mark.kind]}>
          {piece}
        </mark>
      ),
    );
    at = mark.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

const PARTS: Readonly<Record<XRayLine['part'], string | null>> = {
  body: null,
  table: null,
  header: 'Header',
  footer: 'Footer',
  textbox: 'Text box',
};

/** The tag beside a line: the section a heading starts, or where in a Word file the line is. */
function tagOf(line: XRayLine): { text: string; known: boolean } | null {
  if (line.heading !== undefined) {
    return line.heading
      ? { text: SECTION_NAMES[line.heading], known: true }
      : { text: 'Not a heading systems know', known: false };
  }
  const part = PARTS[line.part];
  return part ? { text: part, known: false } : null;
}

/** The text as a parser gets it, a page at a time, with headings and problems marked. */
function TextPane({ result, showing }: { result: XRay; showing: CheckId | null }) {
  const pane = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLLIElement>(null);
  const firstShown = showing ? result.lines.findIndex((line) => line.marks.includes(showing)) : -1;
  // Only the text scrolls to what's shown, never the dialog around it.
  useEffect(() => {
    const [box, line] = [pane.current, first.current];
    if (firstShown < 0 || !box || !line) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 3,
      behavior: still ? 'auto' : 'smooth',
    });
  }, [firstShown]);
  if (result.lines.length === 0) {
    return (
      <div className={styles.text}>
        <p className={styles.empty}>No text to read.</p>
      </div>
    );
  }
  const names = new Map(result.checks.map((check) => [check.id, check.name]));
  const pages = [...new Set(result.lines.map((line) => line.page))];
  // Lines can repeat word for word, so each is known by its place in the file.
  const numbered = result.lines.map((line, at) => ({ line, at }));
  return (
    <div ref={pane} className={styles.text}>
      {pages.map((page) => (
        <section key={page} aria-label={pages.length > 1 ? `Page ${page}` : 'The text'}>
          {pages.length > 1 && <p className={styles.pageBreak}>Page {page}</p>}
          <ol className={styles.lines}>
            {numbered
              .filter(({ line }) => line.page === page)
              .map(({ line, at }) => {
                const tag = tagOf(line);
                const shown = showing !== null && line.marks.includes(showing);
                return (
                  <li
                    key={at}
                    ref={at === firstShown ? first : undefined}
                    className={[
                      styles.line,
                      line.heading !== undefined && styles.headingLine,
                      line.part !== 'body' && line.part !== 'table' && styles.aside,
                      line.marks.length > 0 && styles.flagged,
                      shown && styles.shown,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.lineText}>
                      <MarkedText text={line.text} />
                      {line.marks.length > 0 && (
                        <VisuallyHidden>
                          {` (flagged: ${line.marks.map((id) => names.get(id) ?? id).join(', ')})`}
                        </VisuallyHidden>
                      )}
                    </span>
                    {tag && (
                      <span className={tag.known ? styles.tag : styles.tagQuiet}>{tag.text}</span>
                    )}
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** The X-ray at a glance: whether it reads cleanly, how many key terms it has, what to fix. */
function Summary({ result }: { result: XRay }) {
  const { summary } = result;
  const clean = summary.problems === 0;
  const [headline, ...rest] = summary.text.split(' · ');
  return (
    <div className={styles.summary} role="status">
      <span className={clean ? styles.summaryOk : styles.summaryFix} aria-hidden="true">
        {clean ? <CircleCheck size={22} /> : <TriangleAlert size={22} />}
      </span>
      <span className={styles.summaryText}>
        <span className={styles.summaryHeadline}>{headline}</span>
        {rest.length > 0 && <span className={styles.summaryRest}>{rest.join(' · ')}</span>}
      </span>
    </div>
  );
}

/**
 * The ATS X-ray of a resume's file: the text an applicant tracking system reads, in the order it
 * reads it, beside what it fills in, the problems it would trip on and, for a job's resume, the
 * posting's key terms. A resume with a PDF and a Word file can switch between them.
 */
export function XRayDialog({
  api,
  files,
  start,
  posting,
  onClose,
}: {
  api: Pick<FactwrightApi, 'readPdf' | 'readWord' | 'factBank' | 'copyText'>;
  /** The resume's files: its PDF, its Word file, or both. */
  files: readonly XRayFile[];
  /** The path of the file to show first. */
  start: string;
  /** Reads the job's posting, for a job's resume. Null for a starting resume. */
  posting: (() => Promise<string | null>) | null;
  onClose: () => void;
}) {
  const [path, setPath] = useState(start);
  const file = files.find((each) => each.path === path) ?? (files[0] as XRayFile);
  const state = useXRay(api, file, posting);
  const [tab, setTab] = useState<Tab>('checks');
  const [showing, setShowing] = useState<CheckId | null>(null);
  const [copied, setCopied] = useState(false);
  const result = state.step === 'ready' ? state.result : null;

  const show = (id: CheckId) => setShowing((now) => (now === id ? null : id));
  const copy = async () => {
    if (!result) return;
    const done = await api.copyText(result.lines.map((line) => line.text).join('\n'));
    setCopied(done.ok);
  };
  const problems = result?.checks.filter((check) => check.status !== 'pass').length ?? 0;

  return (
    <Dialog
      title="ATS X-ray"
      description={`${file.name}, read the way applicant tracking systems read it`}
      size="xl"
      onClose={onClose}
    >
      {(close) => (
        <>
          <div className={styles.top}>
            {result ? <Summary result={result} /> : <div className={styles.summary} />}
            {files.length > 1 && (
              <SegmentedControl
                label="File"
                options={files.map((each) => ({
                  value: each.path,
                  label: each.format === 'pdf' ? 'PDF' : 'Word',
                }))}
                value={file.path}
                onChange={(next) => {
                  setPath(next);
                  setShowing(null);
                  setCopied(false);
                }}
              />
            )}
          </div>
          <div className={styles.panes} aria-busy={state.step === 'reading'}>
            {state.step === 'reading' && (
              <p className={styles.status} role="status">
                Reading the file…
              </p>
            )}
            {state.step === 'failed' && (
              <p className={styles.problem} role="alert">
                {state.message}
              </p>
            )}
            {result && (
              <>
                <div className={styles.pane}>
                  <h3 className={styles.paneTitle}>
                    What it reads
                    <span className={styles.paneNote}>in the order a parser gets it</span>
                  </h3>
                  <TextPane result={result} showing={showing} />
                </div>
                <div className={styles.pane}>
                  <SegmentedControl
                    label="Show"
                    options={[
                      {
                        value: 'checks',
                        label: 'Checks',
                        ...(problems > 0 && { count: problems }),
                      },
                      { value: 'keywords', label: 'Keywords' },
                      { value: 'fields', label: 'What it fills in' },
                    ]}
                    value={tab}
                    onChange={setTab}
                  />
                  <div className={styles.report}>
                    {tab === 'checks' && (
                      <ChecksView result={result} showing={showing} onShow={show} />
                    )}
                    {tab === 'keywords' && (
                      <KeywordsView result={result} hasPosting={posting !== null} />
                    )}
                    {tab === 'fields' && <FieldsView result={result} />}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogActions>
            <p className={styles.private}>
              Worked out on this computer, with nothing sent anywhere.
            </p>
            <Button onClick={copy} disabled={!result}>
              {copied ? 'Copied' : 'Copy the text'}
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
