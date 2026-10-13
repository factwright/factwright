import { type Job, type Note, shortDate } from '@factwright/core';
import { Button, IconButton, TextArea } from '@factwright/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { keepsDrafts } from '../unsaved.ts';
import { DateEdit, longDate } from './DateEdit.tsx';
import styles from './JobNotes.module.css';

/** Notes typed but not added yet, by job, so moving to another job and back keeps them. */
const drafts = new Map<string, string>();
keepsDrafts(() => drafts.size > 0);

/** The newest first: by the day they're about, then when they were written. */
const newestFirst = (a: Note, b: Note) => b.on.localeCompare(a.on) || b.at.localeCompare(a.at);

/** How many notes a job has, for its section's heading. */
export function notesSummary(job: Job): string {
  const count = job.notes.length + (job.earlierNotes ? 1 : 0);
  return count === 0 ? 'None yet' : count === 1 ? '1 note' : `${count} notes`;
}

/** Runs an edit, and keeps its problem, if any, to show beside the control. */
function useEdit() {
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (edit: Promise<EditResult>) => {
    const result = await edit;
    setProblem(result.ok ? null : result.message);
    return result.ok;
  };
  return { problem, run };
}

/** A box for jotting a note down, dated today unless the user picks the day it's about. */
function AddNote({ job, api, today }: { job: Job; api: FactwrightApi; today: string }) {
  const [text, setText] = useState(drafts.get(job.id) ?? '');
  // The day the user picked for it, or null for whatever day it is when it's added.
  const [on, setOn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { problem, run } = useEdit();
  const id = useId();
  const type = (value: string) => {
    setText(value);
    if (value) drafts.set(job.id, value);
    else drafts.delete(job.id);
  };
  const add = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    const saved = await run(api.addNote(job.id, on && on !== today ? { text, on } : { text }));
    setSaving(false);
    if (saved) {
      type('');
      setOn(null);
    }
  };
  return (
    <form className={styles.add} onSubmit={add} aria-label="Add a note">
      <label htmlFor={id} className={styles.addLabel}>
        New note
      </label>
      <TextArea
        id={id}
        className={styles.box}
        rows={2}
        value={text}
        maxLength={LIMITS.note}
        placeholder="Jot something down: what was said on a call, names, what to follow up on"
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => {
          // ⌘ Enter on a Mac, Ctrl Enter elsewhere, adds it, as in a chat box.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void add();
        }}
      />
      {text.trim() && (
        <div className={styles.addRow}>
          <span className={styles.for}>
            For{' '}
            <DateEdit
              date={on ?? today}
              label="The day this note is about"
              today={today}
              max={today}
              onChange={setOn}
            />
          </span>
          <Button size="sm" variant="primary" type="submit" disabled={saving}>
            Add note
          </Button>
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** A note as it reads, or a box to change its words, with a confirmation before it's deleted. */
function NoteItem({
  title,
  date,
  text,
  today,
  onSave,
  onRedate,
  onDelete,
  onDeleted,
  max,
}: {
  /** What it's called when read aloud, such as "the note from October 12, 2026". */
  title: string;
  date: string | null;
  text: string;
  today: string;
  onSave: (text: string) => Promise<boolean>;
  onRedate?: ((date: string) => void) | undefined;
  onDelete: () => Promise<boolean>;
  /** Once it's deleted, so the keyboard's focus has somewhere to go. */
  onDeleted?: () => void;
  max?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [deleting, setDeleting] = useState(false);
  const boxId = useId();
  const item = useRef<HTMLLIElement>(null);
  /** Which of its buttons takes the keyboard's focus back once a change or a deletion is done. */
  const back = useRef<'change' | 'delete' | null>(null);
  useEffect(() => {
    if (editing || deleting || !back.current) return;
    item.current?.querySelector<HTMLElement>(`[data-tool="${back.current}"]`)?.focus();
    back.current = null;
  }, [editing, deleting]);
  const stopEditing = () => {
    back.current = 'change';
    setEditing(false);
  };
  return (
    <li ref={item} className={styles.note}>
      <div className={styles.noteHead}>
        <span className={styles.when}>
          {date && onRedate ? (
            <DateEdit
              date={date}
              label={`The day ${title} is about`}
              today={today}
              max={today}
              onChange={onRedate}
            />
          ) : date ? (
            shortDate(date, today)
          ) : (
            'Earlier notes'
          )}
        </span>
        {!editing && !deleting && (
          <span className={styles.tools}>
            <IconButton
              data-tool="change"
              label={`Change ${title}`}
              variant="quiet"
              size="sm"
              icon={<Pencil size={13} aria-hidden="true" />}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            />
            <IconButton
              data-tool="delete"
              label={`Delete ${title}`}
              variant="quiet"
              size="sm"
              icon={<Trash2 size={13} aria-hidden="true" />}
              onClick={() => setDeleting(true)}
            />
          </span>
        )}
      </div>
      {editing ? (
        <form
          className={styles.edit}
          onSubmit={async (event) => {
            event.preventDefault();
            if (draft.trim() === text.trim() || (await onSave(draft))) stopEditing();
          }}
        >
          <label htmlFor={boxId} className={styles.addLabel}>
            {`Change ${title}`}
          </label>
          <TextArea
            id={boxId}
            className={styles.box}
            rows={3}
            value={draft}
            maxLength={max}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                stopEditing();
              }
            }}
          />
          <div className={styles.editActions}>
            <Button size="sm" onClick={stopEditing}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className={styles.text}>{text}</p>
      )}
      {deleting && (
        <div className={styles.confirm}>
          <span>Delete this note?</span>
          <Button
            size="sm"
            onClick={() => {
              back.current = 'delete';
              setDeleting(false);
            }}
          >
            Keep it
          </Button>
          <Button
            size="sm"
            variant="primary"
            // The user just asked to delete it, so the choice to make takes the focus.
            autoFocus
            onClick={async () => {
              if (await onDelete()) onDeleted?.();
              else {
                back.current = 'delete';
                setDeleting(false);
              }
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The user's own notes on a job, each dated the day it's about, newest first, with a box to jot
 * down another. Notes from before notes had dates stay at the end, as they were.
 */
export function JobNotes({ job, api, today }: { job: Job; api: FactwrightApi; today: string }) {
  const { problem, run } = useEdit();
  const notes = [...job.notes].sort(newestFirst);
  const box = useRef<HTMLDivElement>(null);
  // A note deleted, the box for a new one takes the keyboard's focus.
  const deleted = () => box.current?.querySelector('textarea')?.focus();
  return (
    <div ref={box} className={styles.notes}>
      <AddNote key={job.id} job={job} api={api} today={today} />
      {(notes.length > 0 || job.earlierNotes) && (
        <ul className={styles.list} aria-label="Your notes">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              title={`the note from ${longDate(note.on)}`}
              date={note.on}
              text={note.text}
              today={today}
              max={LIMITS.note}
              onSave={(text) => run(api.updateNote(note.id, { text }))}
              onRedate={(on) => void run(api.updateNote(note.id, { on }))}
              onDelete={() => run(api.deleteNote(note.id))}
              onDeleted={deleted}
            />
          ))}
          {job.earlierNotes && (
            <NoteItem
              title="your earlier notes"
              date={null}
              text={job.earlierNotes}
              today={today}
              max={LIMITS.notes}
              onSave={(text) => run(api.updateJob(job.id, { earlierNotes: text }))}
              onDelete={() => run(api.updateJob(job.id, { earlierNotes: null }))}
              onDeleted={deleted}
            />
          )}
        </ul>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
