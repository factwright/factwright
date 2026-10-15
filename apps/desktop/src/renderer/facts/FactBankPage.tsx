import {
  claimParts,
  confirmClaim,
  doesntHave,
  type FactBlock,
  findBlock,
  GAPS_FILE,
  type GapRow,
  isDoesntHave,
  sameBlock,
  shortDate,
  UNCONFIRMED,
} from '@factwright/core';
import {
  Button,
  EmptyState,
  IconButton,
  Markdown,
  MarkdownLine,
  Pill,
  SearchField,
  VisuallyHidden,
} from '@factwright/ui';
import { BookCheck, Check, MessageSquareQuote, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FactBank, FactResult, FactTarget, SkipReason } from '../../shared/facts.ts';
import { usePref } from '../prefs.ts';
import styles from './FactBankPage.module.css';
import { ClaimForm, type EditNotice, forgetDraft, SectionForm } from './FactEditor.tsx';
import {
  bankCounts,
  blockKey,
  detailsWithoutOrigin,
  factCount,
  findFacts,
  hasContent,
  isClaim,
  isUnconfirmed,
  type OriginView,
  originOf,
  tagInfo,
  type Unverified,
  unverifiedFacts,
} from './factView.ts';
import { type FactBankApi, useFactBank } from './useFactBank.ts';

const isPath = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/** Where on the page a block shows: in the list of facts to verify, or in its file. */
type Place = 'unverified' | 'file';

/**
 * A block as it was when the user acted on it, with how it can be told apart in its file, to
 * find it again however the file has changed since, and where on the page they acted on it.
 */
interface Held {
  place: Place;
  path: string;
  block: FactBlock;
  /** Whether no other block in the file read the same, so it can be found by its text if it moved. */
  unique: boolean;
  /** Whether no other block in the file had its heading, so it can be found by that once changed. */
  titled: boolean;
}

/** A block being changed, held as it was when its form opened, or a new claim. */
type Editing =
  | (Held & {
      kind: 'change';
      notice: EditNotice | null;
      /** The edit's own key, which its form keeps the words typed under. */
      draft: string;
    })
  | { kind: 'add'; path: string; draft: string };

type Changing = Extract<Editing, { kind: 'change' }>;

/** Each edit's key: never the same twice, so what's typed for one never shows in another. */
let edits = 0;
const nextDraft = () => `edit-${++edits}`;

/** How many facts to verify show before the rest are asked for. */
const FIRST_TO_VERIFY = 4;

const sameHeading = (a: FactBlock, b: FactBlock) => a.level === b.level && a.title === b.title;

/** A block's key in one place on the page: a fact to verify shows in its file too. */
const placedKey = (place: Place, path: string, block: Pick<FactBlock, 'index'>) =>
  place === 'unverified' ? `unverified:${blockKey(path, block)}` : blockKey(path, block);

/** A block held as it is now, with how it can be told apart among its file's blocks. */
function hold(place: Place, path: string, block: FactBlock, blocks: readonly FactBlock[]): Held {
  return {
    place,
    path,
    block,
    unique: blocks.filter((each) => sameBlock(each.text, block.text)).length === 1,
    titled: blocks.filter((each) => sameHeading(each, block)).length === 1,
  };
}

/** A held block, as the main process looks for it. */
const targetOf = ({ path, block, unique }: Held): FactTarget => ({
  path,
  index: block.index,
  text: block.text,
  unique,
});

/** Where a held block is now, if it reads as it did: -1 when it changed, or went. */
function placeOf(blocks: readonly FactBlock[], held: Held): number {
  return findBlock(blocks, targetOf(held))?.index ?? -1;
}

/**
 * Where a held block is now, even if someone else changed it: where it was, if it reads the same
 * or still has its heading there, or else the one block with its heading, if no other had it.
 * -1 when it's gone.
 */
function changedPlaceOf(blocks: readonly FactBlock[], held: Held): number {
  const same = placeOf(blocks, held);
  if (same >= 0) return same;
  const there = blocks[held.block.index];
  if (there && sameHeading(there, held.block)) return held.block.index;
  if (!held.titled) return -1;
  const titled = blocks.filter((each) => sameHeading(each, held.block));
  return titled.length === 1 ? (titled[0]?.index ?? -1) : -1;
}

/** What to say about a block someone changed while the user had it open. */
function changedNotice(now: FactBlock): EditNotice {
  const wording = now.tags ? claimParts(now).wording.replace(/\s+/g, ' ').trim() : '';
  const shown = wording.length > 200 ? `${wording.slice(0, 199)}…` : wording;
  return {
    title: 'This changed while you had it open',
    text: `Your Claude or another computer changed it.${
      shown ? ` It now says: “${shown}”` : ''
    } Save again to replace that version with yours, or cancel to keep it.`,
  };
}

const SKIPPED: Readonly<Record<SkipReason, string>> = {
  big: 'too big to show here',
  name: 'a name some computers can’t hold',
  many: 'past the first 500 files',
  unreadable: 'couldn’t be read',
};

/** A button of a block, by the block's key and what the button does, to give it the focus. */
const toolOf = (key: string, tool: 'change' | 'delete' | 'confirm') =>
  `[data-key="${key.replace(/["\\]/g, '\\$&')}"] [data-tool="${tool}"]`;

/** The Remove button of something the user said they don't have, by its row. */
const gapToolOf = (index: number) => `[data-gap="${index}"] [data-tool="remove-gap"]`;

/**
 * Each block with its heading's level on the page, under the file's title: a section is one
 * below the section before it at most, and a claim one below the section it's in, so no level is
 * skipped, whatever the file's own headings do.
 */
function headingsOf(blocks: readonly FactBlock[]): [FactBlock, number][] {
  let section = 2;
  return blocks.map((block) => {
    const level = Math.min(block.level + 1, section + 1);
    if (!block.tags && block.level > 0) section = level;
    return [block, level];
  });
}

/** Where a fact to verify came from, and the questions and answers it rests on. */
function OriginLine({ origin }: { origin: OriginView }) {
  return (
    <div className={styles.origin}>
      <p className={styles.originText}>
        <MessageSquareQuote size={14} aria-hidden="true" className={styles.originIcon} />
        {origin.text}
      </p>
      {origin.asked.length > 0 && (
        <dl className={styles.asked}>
          {origin.asked.map(({ question, answer }, i) => (
            <div key={`${i}.${question}`} className={styles.askedPair}>
              <dt>{question}</dt>
              <dd>“{answer}”</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** One claim, or one section such as an overview, with its buttons. */
function BlockView({
  place,
  path,
  block,
  heading,
  opening = false,
  deleting,
  trouble,
  fileTitle,
  origin,
  onOpenFile,
  onChange,
  onDelete,
  onKeep,
  onRemove,
  onConfirm,
}: {
  place: Place;
  path: string;
  block: FactBlock;
  /** Its heading's level on the page, one below the heading it's under. */
  heading: number;
  /** A file's opening, under its title, which shows without a heading of its own. */
  opening?: boolean;
  deleting: boolean;
  trouble: string | null;
  /** For a fact to verify: the title of the file it's in, and where it came from. */
  fileTitle?: string;
  origin?: OriginView | null;
  onOpenFile?: () => void;
  onChange: () => void;
  onDelete: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const asked = useId();
  const key = placedKey(place, path, block);
  const problem = trouble && (
    <p className={styles.problem} role="alert">
      {trouble}
    </p>
  );

  const Heading = `h${Math.min(6, heading)}` as 'h3';
  if (block.tags) {
    const { wording, details } = claimParts(block);
    const toVerify = place === 'unverified';
    // The list of facts to verify says what they are, so each leaves its own tag out.
    const tags = toVerify ? block.tags.filter((tag) => tag !== UNCONFIRMED) : block.tags;
    const shownDetails = toVerify ? detailsWithoutOrigin(details) : details;
    return (
      <article className={styles.fact} data-key={key} aria-labelledby={id}>
        <div className={styles.factHead}>
          <div className={styles.factTitles}>
            <Heading id={id} className={styles.factTitle}>
              {block.title}
            </Heading>
            {toVerify && fileTitle && (
              <button
                type="button"
                className={styles.inFile}
                aria-label={`${fileTitle}: show the whole file`}
                title="Show the whole file"
                onClick={onOpenFile}
              >
                {fileTitle}
              </button>
            )}
          </div>
          <div className={styles.tools}>
            {toVerify ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  data-tool="confirm"
                  icon={<Check size={14} aria-hidden="true" />}
                  aria-label={`Verify “${block.title}”`}
                  onClick={onConfirm}
                >
                  Verify
                </Button>
                <Button
                  size="sm"
                  data-tool="change"
                  icon={<Pencil size={14} aria-hidden="true" />}
                  aria-label={`Edit “${block.title}”, then verify it`}
                  onClick={onChange}
                >
                  Edit
                </Button>
              </>
            ) : (
              <>
                {isUnconfirmed(block) && (
                  <Button
                    size="sm"
                    data-tool="confirm"
                    icon={<Check size={14} aria-hidden="true" />}
                    aria-label={`Verify “${block.title}”`}
                    onClick={onConfirm}
                  >
                    Verify
                  </Button>
                )}
                <IconButton
                  data-tool="change"
                  variant="quiet"
                  size="sm"
                  label={`Change “${block.title}”`}
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={onChange}
                />
              </>
            )}
            <IconButton
              data-tool="delete"
              variant="quiet"
              size="sm"
              label={`Delete “${block.title}”`}
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={onDelete}
            />
          </div>
        </div>
        {tags.length > 0 && (
          <ul className={styles.tags} aria-label="Tags">
            {tags.map((tag, i) => {
              const info = tagInfo(tag);
              return (
                <li key={`${tag}.${i}`} title={info.meaning || undefined}>
                  <Pill tone={info.tone}>{info.label}</Pill>
                </li>
              );
            })}
          </ul>
        )}
        {wording && (
          <p className={styles.wording}>
            <MarkdownLine text={wording.replace(/\s*\n\s*/g, ' ')} />
          </p>
        )}
        {shownDetails && <Markdown className={styles.details} text={shownDetails} />}
        {toVerify && origin && <OriginLine origin={origin} />}
        {deleting && (
          <div className={styles.confirmDelete}>
            <span id={asked}>
              Delete this fact? Resumes you’ve made keep it, but your Claude won’t use it again.
            </span>
            <Button size="sm" onClick={onKeep}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="primary"
              aria-describedby={asked}
              // The user just asked to delete it, so the choice to make takes the focus.
              autoFocus
              onClick={onRemove}
            >
              Delete
            </Button>
          </div>
        )}
        {problem}
      </article>
    );
  }

  const named = block.title || 'the opening text';
  const change = (
    <IconButton
      data-tool="change"
      variant="quiet"
      size="sm"
      label={opening ? 'Change the title and opening' : `Change “${named}”`}
      icon={<Pencil size={14} aria-hidden="true" />}
      onClick={onChange}
    />
  );
  if (opening || block.level === 0) {
    return (
      <div className={styles.opening} data-key={key}>
        {block.body && <Markdown className={styles.openingText} text={block.body} />}
        <div className={styles.openingTools}>{change}</div>
        {problem}
      </div>
    );
  }
  return (
    <section
      className={block.level <= 2 ? styles.section : styles.subsection}
      data-key={key}
      aria-labelledby={id}
    >
      <div className={styles.sectionHead}>
        <Heading id={id} className={styles.sectionTitle}>
          {block.title}
        </Heading>
        {change}
      </div>
      {block.body && <Markdown className={styles.sectionText} text={block.body} />}
      {problem}
    </section>
  );
}

/** A section's words other than its table or list, such as a note under the heading. */
function besidesRows(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^ {0,3}(?:\||[-*+][ \t])/.test(line))
    .join('\n')
    .trim();
}

/**
 * The fact bank, where the user reads and fixes what Factwright knows about them: what waits for
 * them to verify, at the top, then file by file, or searched all at once. A fact can be verified,
 * changed, deleted or added, something they said they don't have can be taken back, and the page
 * keeps up as Claude and other computers change the files.
 */
export function FactBankPage({
  api,
  today,
  onGetStarted,
  show = null,
}: {
  api: FactBankApi;
  today: string;
  /** Goes to getting started, where Claude builds the fact bank. */
  onGetStarted: () => void;
  /**
   * A part of the page to go to, such as the facts to verify after a run filed some, with a
   * number that changes each time it's asked for.
   */
  show?: { part: 'unverified' | 'gaps'; at: number } | null;
}) {
  const { bank, problem, reload, take } = useFactBank(api);
  const [query, setQuery] = useState('');
  const [allToVerify, setAllToVerify] = useState(false);
  const [openPath, setOpenPath] = usePref<string | null>('facts.file', null, isPath);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Held | null>(null);
  const [trouble, setTrouble] = useState<(Held & { message: string }) | null>(null);
  const [gapTrouble, setGapTrouble] = useState<string | null>(null);
  // What just happened, for screen readers, as the focus moves on.
  const [said, setSaid] = useState('');
  const page = useRef<HTMLElement>(null);

  // An edit that's still open when the page goes keeps nothing typed for later.
  const open = useRef(editing);
  open.current = editing;
  useEffect(
    () => () => {
      if (open.current) forgetDraft(open.current.draft);
    },
    [],
  );

  // Where the focus goes once the page shows a change: the first of these that's there.
  const focusing = useRef<{ selectors: string[]; until: number } | null>(null);
  const focusSoon = (...selectors: string[]) => {
    focusing.current = { selectors, until: Date.now() + 3000 };
  };

  // Going to a part of the page, as asked, once the bank has loaded. It comes before the focus
  // moves, so the focus moves there in the same go.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (!show || !bank || shown.current === show.at) return;
    shown.current = show.at;
    setQuery('');
    if (show.part === 'gaps') {
      setOpenPath(GAPS_FILE);
      // The gaps file's own title, once it's open, if it has no Doesn't have section.
      focusSoon('#facts-doesnt-have', `#facts-file-title[data-path="${GAPS_FILE}"]`);
    } else {
      focusSoon('#facts-unverified-title', '#facts-search');
    }
  });

  useEffect(() => {
    const wanted = focusing.current;
    if (!wanted) return;
    if (Date.now() > wanted.until) {
      focusing.current = null;
      return;
    }
    for (const selector of wanted.selectors) {
      const target = page.current?.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        focusing.current = null;
        return;
      }
    }
  });

  const blocksOf = (path: string) => bank?.files.find((each) => each.path === path)?.blocks ?? [];
  const deletingAt = deleting ? placeOf(blocksOf(deleting.path), deleting) : -1;

  // A fact that changed while the user was asked about deleting it isn't deleted: they're told.
  useEffect(() => {
    if (!deleting || deletingAt >= 0) return;
    setDeleting(null);
    setSaid(`“${deleting.block.title}” changed, so it wasn’t deleted.`);
    focusSoon('#facts-search');
  });

  /** Says something to screen readers, even the same thing twice. */
  const announce = (text: string) =>
    setSaid((before) => (before === text ? `${text}\u00a0` : text));

  if (!bank) {
    return (
      <main className={styles.page} ref={page}>
        <h1 className={styles.title}>Fact bank</h1>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : (
          <p className={styles.quiet} role="status">
            Reading your fact bank…
          </p>
        )}
      </main>
    );
  }

  if (bank.files.length === 0 && bank.skipped.length === 0) {
    return (
      <main className={styles.page} ref={page}>
        <h1 className={styles.title}>Fact bank</h1>
        <div className={styles.empty}>
          <EmptyState
            title="No fact bank yet"
            icon={<BookCheck size={20} />}
            action={
              <Button variant="primary" onClick={onGetStarted}>
                Get started
              </Button>
            }
          >
            Every claim on your resumes comes from here. Your Claude builds it from what you share,
            and you can read and change every fact on this page.
          </EmptyState>
        </div>
      </main>
    );
  }

  const counts = bankCounts(bank);
  const searching = query.trim() !== '';
  const toVerify = unverifiedFacts(bank);
  // The file the user last had open, or else the first with facts in it.
  const file =
    bank.files.find((each) => each.path === openPath) ??
    bank.files.find((each) => each.blocks.some(isClaim)) ??
    bank.files[0];
  const claimFiles = bank.files.filter((each) => each.kind === 'claims');
  const source = `${bank.firstName ?? 'confirmed'} ${today}`;
  const textOf = (blocks: readonly FactBlock[]) => blocks.map((block) => block.text).join('');
  const gapsIn = (each: (typeof bank.files)[number]) =>
    each.kind === 'gaps' ? (doesntHave(textOf(each.blocks))?.rows ?? []) : [];

  // Where the block being changed is now, so its form shows in its place.
  const editingAt =
    editing?.kind === 'change' ? changedPlaceOf(blocksOf(editing.path), editing) : -1;
  const editingKey =
    editing?.kind === 'change' && editingAt >= 0
      ? placedKey(editing.place, editing.path, { index: editingAt })
      : null;
  const deletingKey =
    deleting && deletingAt >= 0
      ? placedKey(deleting.place, deleting.path, { index: deletingAt })
      : null;
  const troubleAt = trouble ? changedPlaceOf(blocksOf(trouble.path), trouble) : -1;
  const troubleKey =
    trouble && troubleAt >= 0 ? placedKey(trouble.place, trouble.path, { index: troubleAt }) : null;
  const found = searching
    ? findFacts(bank, {
        query,
        keep: (path, block) => placedKey('file', path, block) === editingKey,
      })
    : [];
  // A fact in the list that's being changed, asked about deleting, or showing what stopped it
  // stays in it, whatever else comes in ahead of it, and while the user searches.
  const pinned = new Set([editingKey, deletingKey, troubleKey]);
  const isPinned = ({ file: each, block }: Unverified) =>
    pinned.has(placedKey('unverified', each.path, block));
  const toVerifyShown = toVerify.filter((each, i) =>
    searching ? isPinned(each) : allToVerify || i < FIRST_TO_VERIFY || isPinned(each),
  );
  // An edit opened in the list stays open even once its fact leaves it, as when it's verified
  // in its file meanwhile.
  const strayEdit =
    editing?.kind === 'change' &&
    editing.place === 'unverified' &&
    editingAt >= 0 &&
    !toVerifyShown.some(
      ({ file: each, block }) => placedKey('unverified', each.path, block) === editingKey,
    );

  /** Ends the edit that's open, dropping what was typed for it. */
  const finish = () => {
    if (editing) forgetDraft(editing.draft);
    setEditing(null);
  };

  const startChange = (place: Place, path: string, block: FactBlock) => {
    if (editing) forgetDraft(editing.draft);
    setDeleting(null);
    setTrouble(null);
    setEditing({
      ...hold(place, path, block, blocksOf(path)),
      kind: 'change',
      notice: null,
      draft: nextDraft(),
    });
  };

  const startAdd = (path: string) => {
    if (editing) forgetDraft(editing.draft);
    setDeleting(null);
    setTrouble(null);
    setEditing({ kind: 'add', path, draft: nextDraft() });
  };

  const openFile = (path: string) => {
    setOpenPath(path);
    setQuery('');
    setDeleting(null);
    setTrouble(null);
    focusSoon('#facts-file-title');
  };

  /** Where a fact is in the list to verify, from 0, or -1. */
  const placeToVerify = (path: string, block: FactBlock) =>
    toVerify.findIndex((each) => each.file.path === path && each.block.index === block.index);

  /**
   * Once a fact leaves the list to verify, the focus goes to the one that took its place there,
   * or the one before, as the bank is now: or else to the list's heading, or the search.
   */
  const focusToVerify = (after: FactBank, at: number) => {
    const list = unverifiedFacts(after);
    const next = list[at] ?? list[at - 1];
    focusSoon(
      ...(next ? [toolOf(placedKey('unverified', next.file.path, next.block), 'confirm')] : []),
      '#facts-unverified-title',
      '#facts-search',
    );
  };

  const saveChange = async (changing: Changing, next: string): Promise<string | null> => {
    const { path, block, place } = changing;
    // Editing a fact to verify verifies it on saving: the user just read and fixed it.
    const verifying = place === 'unverified' && block.tags !== null;
    const text = verifying ? (confirmClaim(next, source) ?? next) : next;
    const at = placeToVerify(path, block);
    const result = await api.changeFact({ ...targetOf(changing), next: text });
    if (result.ok) {
      take(result.bank);
      forgetDraft(changing.draft);
      setEditing(null);
      const now = result.bank.files.find((each) => each.path === path)?.blocks[block.index];
      const title = now?.title || block.title || 'the opening text';
      if (verifying) {
        focusToVerify(result.bank, at);
        announce(`Saved and verified “${title}”.`);
        return null;
      }
      focusSoon(toolOf(placedKey(place, path, block), 'change'), '#facts-search');
      announce(next.trim() ? `Saved “${title}”.` : 'Cleared the opening text.');
      return null;
    }
    if (!result.changed) return result.message;
    // It changed while the form was open. The form stays, with what the user typed, set against
    // the block as it is now, so saving again replaces that version.
    let latest: FactBank | null = null;
    try {
      latest = await api.factBank();
    } catch {
      // The page reads the bank again on its own.
    }
    if (latest) take(latest);
    const blocks = latest?.files.find((each) => each.path === path)?.blocks ?? [];
    const now = blocks[changedPlaceOf(blocks, changing)];
    if (!now || (now.tags === null) !== (block.tags === null)) {
      return 'This was deleted while you had it open. Copy your words if you want them, then cancel.';
    }
    setEditing({ ...changing, ...hold(place, path, now, blocks), notice: changedNotice(now) });
    return null;
  };

  const saveNew = async (text: string, path: string): Promise<string | null> => {
    const result = await api.addFact({ path, text });
    if (!result.ok) return result.message;
    take(result.bank);
    finish();
    setOpenPath(path);
    setQuery('');
    const added = result.bank.files
      .find((each) => each.path === path)
      ?.blocks.find((each) => each.text.replace(/\r\n/g, '\n').trimEnd() === text.trimEnd());
    focusSoon(
      ...(added ? [toolOf(placedKey('file', path, added), 'change')] : []),
      '#facts-file-title',
    );
    announce(`Added “${added?.title ?? 'your fact'}”.`);
    return null;
  };

  /** Runs a change to one block, showing what stopped it beside the block. */
  const act = async (held: Held, action: Promise<FactResult>) => {
    setTrouble(null);
    const result = await action;
    if (result.ok) {
      take(result.bank);
      return result.bank;
    }
    setTrouble({ ...held, message: result.message });
    if (result.changed) void reload();
    return null;
  };

  const remove = async (held: Held) => {
    const { place, path, block } = held;
    setDeleting(null);
    const key = placedKey(place, path, block);
    const at = placeToVerify(path, block);
    const after = await act(held, api.removeFact(targetOf(held)));
    if (!after) {
      focusSoon(toolOf(key, 'delete'), '#facts-search');
      return;
    }
    announce(`Deleted “${block.title}”.`);
    if (place === 'unverified') {
      focusToVerify(after, at);
      return;
    }
    // The focus goes to what took its place, or the one before it.
    const blocks = after.files.find((each) => each.path === path)?.blocks ?? [];
    const next =
      blocks.slice(block.index).find(hasContent) ??
      blocks.slice(0, block.index).reverse().find(hasContent);
    focusSoon(...(next ? [toolOf(placedKey('file', path, next), 'change')] : []), '#facts-search');
  };

  const confirm = async (place: Place, path: string, block: FactBlock) => {
    const held = hold(place, path, block, blocksOf(path));
    const at = placeToVerify(path, block);
    const after = await act(held, api.confirmFact(targetOf(held)));
    if (!after) return;
    // A verified fact leaves the list to verify, so the focus goes to the next one there.
    if (place === 'unverified') focusToVerify(after, at);
    else focusSoon(toolOf(placedKey('file', path, block), 'change'), '#facts-search');
    announce(`Verified “${block.title}”.`);
  };

  const removeGap = async (row: GapRow) => {
    setGapTrouble(null);
    const result = await api.removeGap({ index: row.index, line: row.line });
    if (!result.ok) {
      setGapTrouble(result.message);
      if (result.changed) void reload();
      return;
    }
    take(result.bank);
    // The row after it takes its place, or else the one before.
    focusSoon(gapToolOf(row.index), gapToolOf(row.index - 1), '#facts-doesnt-have');
    announce(`Removed “${row.topic}”. Your Claude can ask about it again.`);
  };

  const changeForm = (changing: Changing) => {
    const key = placedKey(changing.place, changing.path, changing.block);
    const verifying = changing.place === 'unverified' && changing.block.tags !== null;
    const common = {
      draftKey: changing.draft,
      block: changing.block,
      notice: changing.notice,
      onCancel: () => {
        finish();
        focusSoon(toolOf(key, 'change'), '#facts-search');
      },
    };
    return (
      <div key={changing.draft} className={styles.editing} data-key={key}>
        {changing.block.tags ? (
          <ClaimForm
            {...common}
            source={source}
            {...(verifying && { saveLabel: 'Save and verify' })}
            onSave={(text) => saveChange(changing, text)}
          />
        ) : (
          <SectionForm {...common} onSave={(text) => saveChange(changing, text)} />
        )}
      </div>
    );
  };

  const renderBlock = (
    place: Place,
    path: string,
    block: FactBlock,
    heading: number,
    opening = false,
  ) => {
    const key = placedKey(place, path, block);
    if (key === editingKey && editing?.kind === 'change') return changeForm(editing);
    const inFile = bank.files.find((each) => each.path === path);
    return (
      <BlockView
        key={key}
        place={place}
        path={path}
        block={block}
        heading={heading}
        opening={opening}
        deleting={key === deletingKey}
        trouble={key === troubleKey ? (trouble?.message ?? null) : null}
        {...(place === 'unverified' && {
          fileTitle: inFile?.title ?? path,
          origin: originOf(block, today),
          onOpenFile: () => openFile(path),
        })}
        onChange={() => startChange(place, path, block)}
        onDelete={() => {
          setTrouble(null);
          setDeleting(hold(place, path, block, blocksOf(path)));
        }}
        onKeep={() => {
          setDeleting(null);
          focusSoon(toolOf(key, 'delete'));
        }}
        onRemove={() => {
          if (deleting) void remove(deleting);
        }}
        onConfirm={() => void confirm(place, path, block)}
      />
    );
  };

  /** What the user said they don't have, each with a way to take it back. */
  const renderDoesntHave = (path: string, block: FactBlock, heading: number) => {
    const key = placedKey('file', path, block);
    if (key === editingKey && editing?.kind === 'change') return changeForm(editing);
    const rows = file ? gapsIn(file) : [];
    const note = besidesRows(block.body);
    const Heading = `h${Math.min(6, heading)}` as 'h3';
    return (
      <section
        key={key}
        className={styles.section}
        data-key={key}
        aria-labelledby="facts-doesnt-have"
      >
        <div className={styles.sectionHead}>
          <Heading id="facts-doesnt-have" tabIndex={-1} className={styles.sectionTitle}>
            Things you’ve said you don’t have
          </Heading>
          <IconButton
            data-tool="change"
            variant="quiet"
            size="sm"
            label="Change “Things you’ve said you don’t have”"
            icon={<Pencil size={14} aria-hidden="true" />}
            onClick={() => startChange('file', path, block)}
          />
        </div>
        <p className={styles.sectionLead}>
          Your Claude never claims these, and doesn’t ask about them again. Remove one that’s
          changed, and it can ask you about it next time.
        </p>
        {rows.length > 0 ? (
          <ul className={styles.gaps}>
            {rows.map((row) => (
              <li key={`${row.index}.${row.line}`} className={styles.gap} data-gap={row.index}>
                <div className={styles.gapText}>
                  <span className={styles.gapTopic}>
                    <MarkdownLine text={row.topic} />
                  </span>
                  {row.answer && (
                    <span className={styles.gapAnswer}>
                      <MarkdownLine text={row.answer} />
                    </span>
                  )}
                </div>
                {row.date && <span className={styles.gapDate}>{shortDate(row.date, today)}</span>}
                <Button
                  size="sm"
                  variant="quiet"
                  data-tool="remove-gap"
                  aria-label={`Remove “${row.topic}”`}
                  onClick={() => void removeGap(row)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.quiet}>
            Nothing yet. When you tell your Claude you don’t have something a job asks for, it’s
            noted here.
          </p>
        )}
        {note && <Markdown className={styles.sectionText} text={note} />}
        {gapTrouble && (
          <p className={styles.problem} role="alert">
            {gapTrouble}
          </p>
        )}
        {key === troubleKey && (
          <p className={styles.problem} role="alert">
            {trouble?.message}
          </p>
        )}
      </section>
    );
  };

  // A file's first heading is its title, so what's under it shows under the file's name, after
  // any text that comes before it.
  const opening = file?.blocks.find((block) => block.level === 1);
  const openingKey = file && opening ? placedKey('file', file.path, opening) : null;
  const before = file?.blocks.find((block) => block.level === 0 && hasContent(block));
  const fileClaims = file?.blocks.filter(isClaim).length ?? 0;
  const firstAside = bank.files.find((each) => each.kind !== 'claims');
  const matches = (path: string) =>
    found.find((each) => each.file.path === path)?.blocks.filter(isClaim).length ?? 0;
  const foundCount = found.reduce((sum, each) => sum + each.blocks.length, 0);

  return (
    <main className={styles.page} ref={page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Fact bank</h1>
        <p className={styles.subtitle}>
          {counts.claims === 0
            ? 'No facts yet'
            : `${factCount(counts.claims)} in ${counts.files === 1 ? '1 file' : `${counts.files} files`} · ${
                counts.unconfirmed > 0 ? `${counts.unconfirmed} to verify` : 'all verified'
              }`}
        </p>
      </header>
      <p className={styles.lead}>
        Every claim on your resumes and in your answers comes from here. Fix anything that isn’t
        right, and your Claude goes by it from its next task.
      </p>

      {(toVerifyShown.length > 0 || strayEdit || (toVerify.length > 0 && !searching)) && (
        <section className={styles.unverified} aria-labelledby="facts-unverified-title">
          <div className={styles.unverifiedHead}>
            <h2 id="facts-unverified-title" tabIndex={-1} className={styles.unverifiedTitle}>
              Unverified
            </h2>
            {toVerify.length > 0 && (
              <span className={styles.unverifiedCount}>{toVerify.length}</span>
            )}
          </div>
          <p className={styles.unverifiedLead}>
            Your Claude asks you before using these. Verify each one that’s right as written, or
            edit it first.
          </p>
          <div className={styles.unverifiedList}>
            {strayEdit && editing?.kind === 'change' && changeForm(editing)}
            {toVerifyShown.map(({ file: each, block }) =>
              renderBlock('unverified', each.path, block, 3),
            )}
          </div>
          {!searching && toVerify.length > toVerifyShown.length && (
            <div>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  // The first fact it brings in takes the focus, in place of the button.
                  const next = toVerify.find((each) => !toVerifyShown.includes(each));
                  setAllToVerify(true);
                  if (next) {
                    focusSoon(
                      toolOf(placedKey('unverified', next.file.path, next.block), 'confirm'),
                    );
                  }
                }}
              >
                Show all {toVerify.length}
              </Button>
            </div>
          )}
        </section>
      )}

      <div className={styles.toolbar}>
        <SearchField
          id="facts-search"
          className={styles.search}
          label="Search your facts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {bank.skipped.length > 0 && (
        <p className={styles.quiet}>
          Not shown here, and left as they are:{' '}
          {bank.skipped.map(({ path, why }) => `${path} (${SKIPPED[why]})`).join(', ')}.
        </p>
      )}

      <div className={styles.body}>
        <nav className={styles.files} aria-label="Your fact files">
          <ul className={styles.fileList}>
            {bank.files.map((each) => {
              const current = !searching && each === file;
              const count = searching
                ? matches(each.path)
                : each.kind === 'gaps'
                  ? gapsIn(each).length
                  : each.blocks.filter(isClaim).length;
              return (
                <li key={each.path} className={each === firstAside ? styles.aside : undefined}>
                  <button
                    type="button"
                    className={`${styles.fileLink} ${current ? styles.current : ''} ${
                      searching && !found.some((one) => one.file === each) ? styles.dim : ''
                    }`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => openFile(each.path)}
                  >
                    <span className={styles.fileName}>{each.title}</span>{' '}
                    {count > 0 && <span className={styles.fileCount}>{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.content}>
          {editing?.kind === 'change' && editingAt < 0 && changeForm(editing)}
          {trouble && troubleAt < 0 && (
            <p className={styles.problem} role="alert">
              {trouble.message}
            </p>
          )}
          {searching ? (
            <>
              <p className={styles.quiet} role="status">
                {foundCount === 0 ? '' : `${foundCount} found`}
              </p>
              {found.length === 0 ? (
                <EmptyState title="Nothing found">
                  {`Nothing in your fact bank has “${query.trim()}”.`}
                </EmptyState>
              ) : (
                found.map(({ file: each, blocks }, i) => (
                  <section
                    key={each.path}
                    className={styles.group}
                    aria-labelledby={`facts-group-${i}`}
                  >
                    <h2 id={`facts-group-${i}`} className={styles.groupTitle}>
                      <button
                        type="button"
                        className={styles.groupLink}
                        title="Show the whole file"
                        onClick={() => openFile(each.path)}
                      >
                        {each.title}
                      </button>
                    </h2>
                    {blocks.map((block) =>
                      renderBlock('file', each.path, block, 3, block.level <= 1),
                    )}
                  </section>
                ))
              )}
            </>
          ) : (
            file && (
              <section className={styles.file} aria-labelledby="facts-file-title">
                <div className={styles.fileHead} data-key={openingKey ?? undefined}>
                  <div className={styles.fileTitles}>
                    <h2
                      id="facts-file-title"
                      tabIndex={-1}
                      className={styles.fileTitle}
                      data-path={file.path}
                    >
                      {file.title}
                    </h2>
                    <p className={styles.meta}>
                      {file.path}
                      {fileClaims > 0 && ` · ${factCount(fileClaims)}`}
                    </p>
                  </div>
                  <div className={styles.fileTools}>
                    {opening && openingKey !== editingKey && (
                      <IconButton
                        data-tool="change"
                        variant="quiet"
                        size="sm"
                        label="Change the title and opening"
                        icon={<Pencil size={14} aria-hidden="true" />}
                        onClick={() => startChange('file', file.path, opening)}
                      />
                    )}
                    {file.kind === 'claims' && (
                      <Button
                        size="sm"
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => startAdd(file.path)}
                      >
                        Add a fact
                      </Button>
                    )}
                  </div>
                </div>
                {before && renderBlock('file', file.path, before, 3)}
                {editing?.kind === 'change' && openingKey !== null && openingKey === editingKey
                  ? changeForm(editing)
                  : opening?.body && (
                      <Markdown className={styles.openingText} text={opening.body} />
                    )}
                {openingKey && openingKey === troubleKey && (
                  <p className={styles.problem} role="alert">
                    {trouble?.message}
                  </p>
                )}
                {editing?.kind === 'add' && editing.path === file.path && (
                  <div className={styles.editing}>
                    <ClaimForm
                      key={editing.draft}
                      draftKey={editing.draft}
                      block={null}
                      source={source}
                      files={claimFiles}
                      path={editing.path}
                      onSave={saveNew}
                      onCancel={() => {
                        finish();
                        focusSoon('#facts-file-title');
                      }}
                    />
                  </div>
                )}
                {headingsOf(
                  file.blocks.filter(
                    (block) => block !== opening && block !== before && hasContent(block),
                  ),
                ).map(([block, heading]) =>
                  file.kind === 'gaps' && isDoesntHave(block)
                    ? renderDoesntHave(file.path, block, heading)
                    : renderBlock('file', file.path, block, heading),
                )}
              </section>
            )
          )}
        </div>
      </div>
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </main>
  );
}
