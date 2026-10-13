import { claimParts, type FactBlock, findBlock, sameBlock } from '@factwright/core';
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
import { BookCheck, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FactBank, FactResult, FactTarget, SkipReason } from '../../shared/facts.ts';
import { usePref } from '../prefs.ts';
import styles from './FactBankPage.module.css';
import { ClaimForm, type EditNotice, forgetDraft, SectionForm } from './FactEditor.tsx';
import {
  bankCounts,
  blockKey,
  factCount,
  findFacts,
  hasContent,
  isClaim,
  isUnconfirmed,
  tagInfo,
} from './factView.ts';
import { type FactBankApi, useFactBank } from './useFactBank.ts';

const isPath = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/**
 * A block as it was when the user acted on it, with how it can be told apart in its file, to
 * find it again however the file has changed since.
 */
interface Held {
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

const sameHeading = (a: FactBlock, b: FactBlock) => a.level === b.level && a.title === b.title;

/** A block held as it is now, with how it can be told apart among its file's blocks. */
function hold(path: string, block: FactBlock, blocks: readonly FactBlock[]): Held {
  return {
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

/** One claim, or one section such as an overview, with its buttons. */
function BlockView({
  path,
  block,
  heading,
  opening = false,
  deleting,
  trouble,
  onChange,
  onDelete,
  onKeep,
  onRemove,
  onConfirm,
}: {
  path: string;
  block: FactBlock;
  /** Its heading's level on the page, one below the heading it's under. */
  heading: number;
  /** A file's opening, under its title, which shows without a heading of its own. */
  opening?: boolean;
  deleting: boolean;
  trouble: string | null;
  onChange: () => void;
  onDelete: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const asked = useId();
  const key = blockKey(path, block);
  const problem = trouble && (
    <p className={styles.problem} role="alert">
      {trouble}
    </p>
  );

  const Heading = `h${Math.min(6, heading)}` as 'h3';
  if (block.tags) {
    const { wording, details } = claimParts(block);
    return (
      <article className={styles.fact} data-key={key} aria-labelledby={id}>
        <div className={styles.factHead}>
          <Heading id={id} className={styles.factTitle}>
            {block.title}
          </Heading>
          <div className={styles.tools}>
            {isUnconfirmed(block) && (
              <Button
                size="sm"
                data-tool="confirm"
                icon={<Check size={14} aria-hidden="true" />}
                aria-label={`Confirm “${block.title}”`}
                onClick={onConfirm}
              >
                Confirm
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
        <ul className={styles.tags} aria-label="Tags">
          {block.tags.map((tag, i) => {
            const info = tagInfo(tag);
            return (
              <li key={`${tag}.${i}`} title={info.meaning || undefined}>
                <Pill tone={info.tone}>{info.label}</Pill>
              </li>
            );
          })}
        </ul>
        {wording && (
          <p className={styles.wording}>
            <MarkdownLine text={wording.replace(/\s*\n\s*/g, ' ')} />
          </p>
        )}
        {details && <Markdown className={styles.details} text={details} />}
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

/**
 * The fact bank, where the user reads and fixes what Factwright knows about them: file by file,
 * or searched all at once, or just the facts still to confirm. A fact can be changed, confirmed,
 * deleted or added, and the page keeps up as Claude and other computers change the files.
 */
export function FactBankPage({
  api,
  today,
  onGetStarted,
}: {
  api: FactBankApi;
  today: string;
  /** Goes to getting started, where Claude builds the fact bank. */
  onGetStarted: () => void;
}) {
  const { bank, problem, reload, take } = useFactBank(api);
  const [query, setQuery] = useState('');
  const [toConfirm, setToConfirm] = useState(false);
  const [openPath, setOpenPath] = usePref<string | null>('facts.file', null, isPath);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Held | null>(null);
  const [trouble, setTrouble] = useState<(Held & { message: string }) | null>(null);
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

  // With nothing left to confirm, the page shows the files again, and stays there.
  const unconfirmed = bank ? bankCounts(bank).unconfirmed : 0;
  useEffect(() => {
    if (toConfirm && bank && unconfirmed === 0) setToConfirm(false);
  }, [toConfirm, bank, unconfirmed]);

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
  const confirming = toConfirm && counts.unconfirmed > 0;
  const searching = query.trim() !== '' || confirming;
  // The file the user last had open, or else the first with facts in it.
  const file =
    bank.files.find((each) => each.path === openPath) ??
    bank.files.find((each) => each.blocks.some(isClaim)) ??
    bank.files[0];
  const claimFiles = bank.files.filter((each) => each.kind === 'claims');
  const source = `${bank.firstName ?? 'confirmed'} ${today}`;

  // Where the block being changed is now, so its form shows in its place.
  const editingAt =
    editing?.kind === 'change' ? changedPlaceOf(blocksOf(editing.path), editing) : -1;
  const editingKey =
    editing?.kind === 'change' && editingAt >= 0
      ? blockKey(editing.path, { index: editingAt })
      : null;
  const deletingKey =
    deleting && deletingAt >= 0 ? blockKey(deleting.path, { index: deletingAt }) : null;
  const troubleAt = trouble ? changedPlaceOf(blocksOf(trouble.path), trouble) : -1;
  const troubleKey =
    trouble && troubleAt >= 0 ? blockKey(trouble.path, { index: troubleAt }) : null;
  const found = searching
    ? findFacts(bank, {
        query,
        toConfirm: confirming,
        keep: (path, block) => blockKey(path, block) === editingKey,
      })
    : [];

  /** Ends the edit that's open, dropping what was typed for it. */
  const finish = () => {
    if (editing) forgetDraft(editing.draft);
    setEditing(null);
  };

  const startChange = (path: string, block: FactBlock) => {
    if (editing) forgetDraft(editing.draft);
    setDeleting(null);
    setTrouble(null);
    setEditing({
      ...hold(path, block, blocksOf(path)),
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
    setToConfirm(false);
    setDeleting(null);
    setTrouble(null);
    focusSoon('#facts-file-title');
  };

  const saveChange = async (changing: Changing, next: string): Promise<string | null> => {
    const { path, block } = changing;
    const result = await api.changeFact({ ...targetOf(changing), next });
    if (result.ok) {
      take(result.bank);
      forgetDraft(changing.draft);
      setEditing(null);
      const now = result.bank.files.find((each) => each.path === path)?.blocks[block.index];
      focusSoon(toolOf(blockKey(path, block), 'change'), '#facts-search');
      announce(
        next.trim()
          ? `Saved “${now?.title || block.title || 'the opening text'}”.`
          : 'Cleared the opening text.',
      );
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
    setEditing({ ...changing, ...hold(path, now, blocks), notice: changedNotice(now) });
    return null;
  };

  const saveNew = async (text: string, path: string): Promise<string | null> => {
    const result = await api.addFact({ path, text });
    if (!result.ok) return result.message;
    take(result.bank);
    finish();
    setOpenPath(path);
    setQuery('');
    setToConfirm(false);
    const added = result.bank.files
      .find((each) => each.path === path)
      ?.blocks.find((each) => each.text.replace(/\r\n/g, '\n').trimEnd() === text.trimEnd());
    focusSoon(...(added ? [toolOf(blockKey(path, added), 'change')] : []), '#facts-file-title');
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
    const { path, block } = held;
    setDeleting(null);
    const after = await act(held, api.removeFact(targetOf(held)));
    if (!after) {
      focusSoon(toolOf(blockKey(path, block), 'delete'), '#facts-search');
      return;
    }
    // The focus goes to what took its place, or the one before it.
    const blocks = after.files.find((each) => each.path === path)?.blocks ?? [];
    const next =
      blocks.slice(block.index).find(hasContent) ??
      blocks.slice(0, block.index).reverse().find(hasContent);
    focusSoon(...(next ? [toolOf(blockKey(path, next), 'change')] : []), '#facts-search');
    announce(`Deleted “${block.title}”.`);
  };

  const confirm = async (path: string, block: FactBlock) => {
    const held = hold(path, block, blocksOf(path));
    if (!(await act(held, api.confirmFact(targetOf(held))))) return;
    // Among the facts still to confirm, it leaves the list, so the focus goes to the next one.
    focusSoon(toolOf(blockKey(path, block), 'change'), '[data-tool="confirm"]', '#facts-search');
    announce(`Confirmed “${block.title}”.`);
  };

  const changeForm = (changing: Changing) => {
    const key = blockKey(changing.path, changing.block);
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
          <ClaimForm {...common} source={source} onSave={(text) => saveChange(changing, text)} />
        ) : (
          <SectionForm {...common} onSave={(text) => saveChange(changing, text)} />
        )}
      </div>
    );
  };

  const renderBlock = (path: string, block: FactBlock, heading: number, opening = false) => {
    const key = blockKey(path, block);
    if (key === editingKey && editing?.kind === 'change') return changeForm(editing);
    return (
      <BlockView
        key={key}
        path={path}
        block={block}
        heading={heading}
        opening={opening}
        deleting={key === deletingKey}
        trouble={key === troubleKey ? (trouble?.message ?? null) : null}
        onChange={() => startChange(path, block)}
        onDelete={() => {
          setTrouble(null);
          setDeleting(hold(path, block, blocksOf(path)));
        }}
        onKeep={() => {
          setDeleting(null);
          focusSoon(toolOf(key, 'delete'));
        }}
        onRemove={() => {
          if (deleting) void remove(deleting);
        }}
        onConfirm={() => void confirm(path, block)}
      />
    );
  };

  // A file's first heading is its title, so what's under it shows under the file's name, after
  // any text that comes before it.
  const opening = file?.blocks.find((block) => block.level === 1);
  const openingKey = file && opening ? blockKey(file.path, opening) : null;
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
                counts.unconfirmed > 0
                  ? `${counts.unconfirmed} to confirm with you`
                  : 'all confirmed with you'
              }`}
        </p>
      </header>
      <p className={styles.lead}>
        Every claim on your resumes and in your answers comes from here. Fix anything that isn’t
        right, and your Claude goes by it from its next task.
      </p>
      <div className={styles.toolbar}>
        <SearchField
          id="facts-search"
          className={styles.search}
          label="Search your facts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {counts.unconfirmed > 0 && (
          <Button
            size="sm"
            variant={confirming ? 'primary' : 'secondary'}
            aria-pressed={confirming}
            onClick={() => setToConfirm(!confirming)}
          >
            To confirm · {counts.unconfirmed}
          </Button>
        )}
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
              const shown = !searching && each === file;
              const count = searching ? matches(each.path) : each.blocks.filter(isClaim).length;
              return (
                <li key={each.path} className={each === firstAside ? styles.aside : undefined}>
                  <button
                    type="button"
                    className={`${styles.fileLink} ${shown ? styles.current : ''} ${
                      searching && !found.some((one) => one.file === each) ? styles.dim : ''
                    }`}
                    aria-current={shown ? 'true' : undefined}
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
                {foundCount === 0
                  ? ''
                  : confirming && !query.trim()
                    ? `${factCount(foundCount)} to confirm. Confirm each that’s right as written, or change it first.`
                    : `${foundCount} found`}
              </p>
              {found.length === 0 ? (
                <EmptyState title={confirming ? 'Nothing left to confirm' : 'Nothing found'}>
                  {query.trim()
                    ? `Nothing in your fact bank has “${query.trim()}”.`
                    : 'Every fact is confirmed.'}
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
                    {blocks.map((block) => renderBlock(each.path, block, 3, block.level <= 1))}
                  </section>
                ))
              )}
            </>
          ) : (
            file && (
              <section className={styles.file} aria-labelledby="facts-file-title">
                <div className={styles.fileHead} data-key={openingKey ?? undefined}>
                  <div className={styles.fileTitles}>
                    <h2 id="facts-file-title" tabIndex={-1} className={styles.fileTitle}>
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
                        onClick={() => startChange(file.path, opening)}
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
                {before && renderBlock(file.path, before, 3)}
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
                ).map(([block, heading]) => renderBlock(file.path, block, heading))}
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
