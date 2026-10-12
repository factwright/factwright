import { claimParts, type FactBlock } from '@factwright/core';
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
import type { FactBank, FactResult } from '../../shared/facts.ts';
import { usePref } from '../prefs.ts';
import styles from './FactBankPage.module.css';
import { ClaimForm, type EditNotice, SectionForm } from './FactEditor.tsx';
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

/** A block being changed, as it was when its form opened, or a new claim. */
type Editing =
  | {
      kind: 'change';
      path: string;
      block: FactBlock;
      notice: EditNotice | null;
      /** What the form keeps its words under, from when it opened. */
      draft: string;
    }
  | { kind: 'add'; path: string; draft: string };

type Changing = Extract<Editing, { kind: 'change' }>;

const CHANGED_NOTICE: EditNotice = {
  title: 'This changed while you had it open',
  text: 'Your Claude or another computer changed it. Save again to replace that version with yours, or cancel to keep it.',
};

/** A button of a block, by the block's key and what the button does, to give it the focus. */
const toolOf = (key: string, tool: 'change' | 'delete' | 'confirm') =>
  `[data-key="${key.replace(/["\\]/g, '\\$&')}"] [data-tool="${tool}"]`;

/**
 * Where a block being changed is now: the block that reads the same, or else the one with its
 * heading where it was, or anywhere. -1 when it's gone.
 */
function placeOf(blocks: readonly FactBlock[], block: FactBlock): number {
  const same = blocks.findIndex((each) => each.text.trimEnd() === block.text.trimEnd());
  if (same >= 0) return same;
  if (blocks[block.index]?.title === block.title) return block.index;
  return blocks.findIndex((each) => each.title === block.title && each.level === block.level);
}

/**
 * Each block with its heading's level on the page, under the file's title: a section is one
 * below the section before it at most, and a claim one below the section it's in, so no level is
 * skipped, whatever the file's own headings do.
 */
function headingsOf(blocks: readonly FactBlock[]): [FactBlock, number][] {
  let section = 2;
  return blocks.map((block) => {
    const level = Math.min(block.level + 1, section + 1);
    if (!block.tags) section = level;
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
            <span>
              Delete this fact? Resumes you’ve made keep it, but your Claude won’t use it again.
            </span>
            <Button size="sm" onClick={onKeep}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="primary"
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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<{ key: string; message: string } | null>(null);
  // What just happened, for screen readers, as the focus moves on.
  const [said, setSaid] = useState('');
  const page = useRef<HTMLElement>(null);

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

  if (bank.files.length === 0) {
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
  const editingFile =
    editing?.kind === 'change' ? bank.files.find((each) => each.path === editing.path) : undefined;
  const editingAt =
    editing?.kind === 'change' && editingFile ? placeOf(editingFile.blocks, editing.block) : -1;
  const editingKey =
    editing?.kind === 'change' && editingAt >= 0
      ? blockKey(editing.path, { index: editingAt })
      : null;
  const found = searching
    ? findFacts(bank, {
        query,
        toConfirm: confirming,
        keep: (path, block) => blockKey(path, block) === editingKey,
      })
    : [];

  const startChange = (path: string, block: FactBlock) => {
    setDeleting(null);
    setTrouble(null);
    setEditing({ kind: 'change', path, block, notice: null, draft: blockKey(path, block) });
  };

  const startAdd = (path: string) => {
    setDeleting(null);
    setTrouble(null);
    setEditing({ kind: 'add', path, draft: `new:${path}` });
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
    const result = await api.changeFact({ path, index: block.index, text: block.text, next });
    if (result.ok) {
      take(result.bank);
      setEditing(null);
      const now = result.bank.files.find((each) => each.path === path)?.blocks[block.index];
      focusSoon(toolOf(blockKey(path, block), 'change'), '#facts-search');
      setSaid(`Saved “${now?.title || block.title || 'the opening text'}”.`);
      return null;
    }
    if (!result.changed) return result.message;
    // It changed while the form was open. The form stays, with the user's words, set against
    // the block as it is now, so saving again replaces that version.
    let latest: FactBank | null = null;
    try {
      latest = await api.factBank();
    } catch {
      // The page reads the bank again on its own.
    }
    if (latest) take(latest);
    const blocks = latest?.files.find((each) => each.path === path)?.blocks ?? [];
    const now = blocks[placeOf(blocks, block)];
    if (!now)
      return 'This was deleted while you had it open. Copy your words if you want them, then cancel.';
    setEditing({ ...changing, block: now, notice: CHANGED_NOTICE });
    return null;
  };

  const saveNew = async (text: string, path: string): Promise<string | null> => {
    const result = await api.addFact({ path, text });
    if (!result.ok) return result.message;
    take(result.bank);
    setEditing(null);
    setOpenPath(path);
    setQuery('');
    setToConfirm(false);
    const added = result.bank.files
      .find((each) => each.path === path)
      ?.blocks.find((each) => each.text.replace(/\r\n/g, '\n').trimEnd() === text.trimEnd());
    focusSoon(...(added ? [toolOf(blockKey(path, added), 'change')] : []), '#facts-file-title');
    setSaid(`Added “${added?.title ?? 'your fact'}”.`);
    return null;
  };

  /** Runs a change to one block, showing what stopped it beside the block. */
  const act = async (path: string, block: FactBlock, action: Promise<FactResult>) => {
    const key = blockKey(path, block);
    setTrouble(null);
    const result = await action;
    if (result.ok) {
      take(result.bank);
      return result.bank;
    }
    setTrouble({ key, message: result.message });
    if (result.changed) void reload();
    return null;
  };

  const remove = async (path: string, block: FactBlock) => {
    const target = { path, index: block.index, text: block.text };
    const after = await act(path, block, api.removeFact(target));
    setDeleting(null);
    if (!after) {
      focusSoon(toolOf(blockKey(path, block), 'delete'));
      return;
    }
    // The focus goes to what took its place, or the one before it.
    const blocks = after.files.find((each) => each.path === path)?.blocks ?? [];
    const next =
      blocks.slice(block.index).find(hasContent) ??
      blocks.slice(0, block.index).reverse().find(hasContent);
    focusSoon(...(next ? [toolOf(blockKey(path, next), 'change')] : []), '#facts-search');
    setSaid(`Deleted “${block.title}”.`);
  };

  const confirm = async (path: string, block: FactBlock) => {
    const target = { path, index: block.index, text: block.text };
    if (!(await act(path, block, api.confirmFact(target)))) return;
    // Among the facts still to confirm, it leaves the list, so the focus goes to the next one.
    focusSoon(toolOf(blockKey(path, block), 'change'), '[data-tool="confirm"]', '#facts-search');
    setSaid(`Confirmed “${block.title}”.`);
  };

  const changeForm = (changing: Changing) => {
    const key = blockKey(changing.path, changing.block);
    const common = {
      draftKey: changing.draft,
      block: changing.block,
      notice: changing.notice,
      onCancel: () => {
        setEditing(null);
        focusSoon(toolOf(key, 'change'), '#facts-search');
      },
    };
    return (
      <div className={styles.editing} data-key={key}>
        {changing.block.tags ? (
          <ClaimForm
            key={changing.draft}
            {...common}
            source={source}
            onSave={(text) => saveChange(changing, text)}
          />
        ) : (
          <SectionForm
            key={changing.draft}
            {...common}
            onSave={(text) => saveChange(changing, text)}
          />
        )}
      </div>
    );
  };

  const renderBlock = (path: string, block: FactBlock, heading: number, opening = false) => {
    const key = blockKey(path, block);
    if (key === editingKey && editing?.kind === 'change') {
      return <div key={key}>{changeForm(editing)}</div>;
    }
    return (
      <BlockView
        key={key}
        path={path}
        block={block}
        heading={heading}
        opening={opening}
        deleting={deleting === key}
        trouble={trouble?.key === key ? trouble.message : null}
        onChange={() => startChange(path, block)}
        onDelete={() => {
          setTrouble(null);
          setDeleting(key);
        }}
        onKeep={() => {
          setDeleting(null);
          focusSoon(toolOf(key, 'delete'));
        }}
        onRemove={() => void remove(path, block)}
        onConfirm={() => void confirm(path, block)}
      />
    );
  };

  // A file's first heading is its title, so what's under it shows under the file's name.
  const opening = file?.blocks.find((block) => block.level === 1);
  const openingKey = file && opening ? blockKey(file.path, opening) : null;
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
          Too big to show here, so left as they are: {bank.skipped.join(', ')}.
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
                    {blocks.map((block) => renderBlock(each.path, block, 3, block.level === 1))}
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
                {editing?.kind === 'change' && openingKey !== null && openingKey === editingKey
                  ? changeForm(editing)
                  : opening?.body && (
                      <Markdown className={styles.openingText} text={opening.body} />
                    )}
                {openingKey && trouble?.key === openingKey && (
                  <p className={styles.problem} role="alert">
                    {trouble.message}
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
                        setEditing(null);
                        focusSoon('#facts-file-title');
                      }}
                    />
                  </div>
                )}
                {headingsOf(
                  file.blocks.filter((block) => block !== opening && hasContent(block)),
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
