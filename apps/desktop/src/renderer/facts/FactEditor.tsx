import {
  claimParts,
  claimText,
  FACT_TAGS,
  type FactBlock,
  sectionParts,
  sectionText,
} from '@factwright/core';
import { Button, Field, Input, Notice, Select, TextArea } from '@factwright/ui';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { FACT_LIMITS } from '../../shared/facts.ts';
import styles from './FactEditor.module.css';
import { picksOf, type TagPicks, tagInfo, tagsWith } from './factView.ts';

/** How long a resume line runs before it wraps: about two lines in most templates. */
const WORDING_FITS = 190;

/**
 * Saves the new text, answering with what stopped it, or null with nothing to say: it saved, or
 * a notice above the form says why it didn't.
 */
type Save = (text: string) => Promise<string | null>;

/** Something to know before saving, such as that the block changed while it was open. */
export interface EditNotice {
  title: string;
  text: string;
}

function EditNoticeLine({ notice }: { notice: EditNotice | null | undefined }) {
  return notice ? (
    <Notice tone="need" title={notice.title}>
      {notice.text}
    </Notice>
  ) : null;
}

/**
 * What's typed in a form and not saved yet, by the edit it's for, so going to another file and
 * back keeps it. Each edit has a key of its own, which the page drops once the edit is over, so
 * what's typed for one block never turns up in another.
 */
const drafts = new Map<string, { form: 'claim' | 'section'; draft: unknown }>();

/** Drops what was typed for an edit, once it's saved, cancelled or left. */
export const forgetDraft = (key: string) => drafts.delete(key);

/** A form's words, kept in `drafts` under the edit's key while it lasts. */
function useDraft<T>(key: string, form: 'claim' | 'section', start: () => T) {
  const [draft, setDraft] = useState<T>(() => {
    const kept = drafts.get(key);
    return kept?.form === form ? (kept.draft as T) : start();
  });
  const change = (next: T) => {
    drafts.set(key, { form, draft: next });
    setDraft(next);
  };
  return [draft, change] as const;
}

/** The buttons and keys every form here shares: ⌘ Enter saves, and Escape cancels. */
function useForm(save: () => Promise<string | null>, onCancel: () => void) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      setProblem(await save());
    } finally {
      setSaving(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };
  return { saving, problem, submit, onKeyDown, onCancel };
}

function Actions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className={styles.actions}>
      <Button size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" type="submit" disabled={saving}>
        Save
      </Button>
    </div>
  );
}

function Problem({ problem }: { problem: string | null }) {
  return problem ? (
    <p className={styles.problem} role="alert">
      {problem}
    </p>
  ) : null;
}

/** A menu of one kind of tag, with what the picked one means under it. */
function TagSelect({
  label,
  tags,
  value,
  none,
  onChange,
}: {
  label: string;
  tags: readonly string[];
  value: string;
  /** What the empty choice says, such as "None", or "Pick one" for one that's needed. */
  none: string;
  onChange: (tag: string) => void;
}) {
  return (
    <Field label={label} hint={value ? tagInfo(value).meaning : undefined} className={styles.tag}>
      {(control) => (
        <Select {...control} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{none}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tagInfo(tag).label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * The form for a claim: its title, the words resumes use, its status, ownership and confidence,
 * and its details. A new claim also picks its file, and gives the user as its source.
 */
export function ClaimForm({
  draftKey,
  block,
  source,
  files,
  path: startPath,
  notice,
  onSave,
  onCancel,
}: {
  /** What the form is for, such as the claim's place, to keep what's typed under. */
  draftKey: string;
  /** The claim as it was, or null for a new one. */
  block: FactBlock | null;
  /** Who a new claim is from, and when, such as "Alex 2026-10-12". */
  source: string;
  /** For a new claim: the files of facts it can go in. */
  files?: readonly { path: string; title: string }[];
  /** For a new claim: the file it goes in to start with. */
  path?: string;
  notice?: EditNotice | null;
  onSave: (text: string, path: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const parts = block
    ? claimParts(block)
    : {
        title: '',
        tags: [],
        tagNote: '',
        wording: '',
        spaced: false,
        details: `- **Source:** ${source}`,
      };
  const [draft, setDraft] = useDraft(draftKey, 'claim', () => ({
    title: parts.title,
    wording: parts.wording,
    details: parts.details,
    picks: picksOf(parts.tags),
    path: startPath ?? files?.[0]?.path ?? '',
  }));
  const { title, wording, details, picks, path } = draft;
  const set = (changes: Partial<typeof draft>) => setDraft({ ...draft, ...changes });
  const pick = (kind: keyof TagPicks) => (tag: string) => set({ picks: { ...picks, [kind]: tag } });
  const form = useForm(async () => {
    if (!title.trim()) return 'Give it a title.';
    if (!block && !picks.status) return 'Pick its status, such as live or shipped.';
    const tags = tagsWith(parts.tags, picks);
    if (tags.length === 0) return 'Pick its status, such as live or shipped.';
    return onSave(claimText({ ...parts, title, tags, wording, details }), path);
  }, onCancel);
  const length = wording.trim().length;

  return (
    <form
      className={styles.form}
      aria-label={block ? `Change “${block.title}”` : 'New fact'}
      onSubmit={form.submit}
      onKeyDown={form.onKeyDown}
    >
      <EditNoticeLine notice={notice} />
      {files && files.length > 1 && (
        <Field label="File">
          {(control) => (
            <Select
              {...control}
              value={path}
              onChange={(event) => set({ path: event.target.value })}
            >
              {files.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="Title" hint="A few words, for you and Claude to find it by.">
        {(control) => (
          <Input
            {...control}
            value={title}
            maxLength={FACT_LIMITS.title}
            // A new fact starts with its title; a fact being changed, with its words.
            autoFocus={!block}
            onChange={(event) => set({ title: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="What resumes say"
        hint={
          length > WORDING_FITS
            ? `${length} characters: longer than a resume line, which fits about ${WORDING_FITS}.`
            : `${length} characters. A resume line fits about ${WORDING_FITS}.`
        }
      >
        {(control) => (
          <TextArea
            {...control}
            className={styles.wording}
            rows={2}
            value={wording}
            maxLength={FACT_LIMITS.block}
            autoFocus={block !== null}
            onChange={(event) => set({ wording: event.target.value })}
          />
        )}
      </Field>
      <div className={styles.tags}>
        <TagSelect
          label="Status"
          tags={FACT_TAGS.status}
          value={picks.status}
          none={block ? 'None' : 'Pick one'}
          onChange={pick('status')}
        />
        <TagSelect
          label="Ownership"
          tags={FACT_TAGS.ownership}
          value={picks.ownership}
          none="None"
          onChange={pick('ownership')}
        />
        <TagSelect
          label="Confidence"
          tags={FACT_TAGS.confidence}
          value={picks.confidence}
          none="None"
          onChange={pick('confidence')}
        />
      </div>
      <Field
        label="Details"
        hint="A line each, such as - **Numbers:** 40 clinics, - **Keywords:** or - **Source:**."
      >
        {(control) => (
          <TextArea
            {...control}
            className={styles.details}
            rows={4}
            value={details}
            maxLength={FACT_LIMITS.block}
            onChange={(event) => set({ details: event.target.value })}
          />
        )}
      </Field>
      <Problem problem={form.problem} />
      <Actions saving={form.saving} onCancel={form.onCancel} />
    </form>
  );
}

/** The form for any other part of a file, such as its overview: its heading and its words. */
export function SectionForm({
  draftKey,
  block,
  notice,
  onSave,
  onCancel,
}: {
  /** What the form is for, such as the section's place, to keep what's typed under. */
  draftKey: string;
  block: FactBlock;
  notice?: EditNotice | null;
  onSave: Save;
  onCancel: () => void;
}) {
  const parts = sectionParts(block);
  const [draft, setDraft] = useDraft(draftKey, 'section', () => ({
    title: parts.title,
    body: parts.body,
  }));
  const { title, body } = draft;
  const form = useForm(async () => {
    if (block.level > 0 && !title.trim()) return 'Give it a heading.';
    return onSave(sectionText(block.level, { ...parts, title, body }));
  }, onCancel);

  return (
    <form
      className={styles.form}
      aria-label={block.title ? `Change “${block.title}”` : 'Change the opening text'}
      onSubmit={form.submit}
      onKeyDown={form.onKeyDown}
    >
      <EditNoticeLine notice={notice} />
      {block.level > 0 && (
        <Field label="Heading">
          {(control) => (
            <Input
              {...control}
              value={title}
              maxLength={FACT_LIMITS.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          )}
        </Field>
      )}
      <Field label="Text" hint="Markdown: - for a list, **bold**, and | for a table’s columns.">
        {(control) => (
          <TextArea
            {...control}
            className={styles.details}
            rows={6}
            value={body}
            maxLength={FACT_LIMITS.block}
            autoFocus
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        )}
      </Field>
      <Problem problem={form.problem} />
      <Actions saving={form.saving} onCancel={form.onCancel} />
    </form>
  );
}
