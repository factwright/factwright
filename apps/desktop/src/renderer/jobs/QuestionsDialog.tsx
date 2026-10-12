import type { Job } from '@factwright/core';
import { Button, Dialog, DialogActions, IconButton, TextArea } from '@factwright/ui';
import { Plus, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './QuestionsDialog.module.css';
import { pictureUrl, readPictures, Screenshots, type ShownShot, typeOf } from './Screenshots.tsx';

/** The questions with text, trimmed. */
const filled = (questions: readonly string[]) =>
  questions.map((question) => question.trim()).filter(Boolean);

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** One question's box. Its ID keeps it apart from the others as boxes come and go. */
interface Box {
  id: number;
  text: string;
}

/**
 * The questions on a job's application form, one box each, or screenshots of the form, for
 * Claude to answer. They're kept with the job however the dialog closes, so nothing pasted is
 * lost: questions as they're typed, and screenshots the moment they're added. Answer with Claude
 * starts the run that answers them; Claude reads them through job_details, never as typed
 * commands.
 */
export function QuestionsDialog({
  job,
  api,
  onAnswer,
  onClose,
}: {
  job: Job;
  api: FactwrightApi;
  /** Starts the run that answers the questions, once they're saved. */
  onAnswer: () => void;
  onClose: () => void;
}) {
  const nextId = useRef(0);
  const box = (text = ''): Box => ({ id: nextId.current++, text });
  const [boxes, setBoxes] = useState<Box[]>(() =>
    job.questions.length > 0 ? job.questions.map((text) => box(text)) : [box()],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shots, setShots] = useState<ShownShot[]>([]);
  // The box to focus after adding or removing one.
  const [focus, setFocus] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const saved = useRef<readonly string[]>(job.questions);
  // The latest questions, for saving as the dialog closes.
  const questions = boxes.map(({ text }) => text);
  const latest = useRef(questions);
  latest.current = questions;

  useEffect(() => {
    if (focus === null) return;
    list.current?.querySelectorAll('textarea')[focus]?.focus();
    setFocus(null);
  }, [focus]);

  // Screenshots of the form added before come back with the questions.
  useEffect(() => {
    let live = true;
    void api.jobExtras(job.id).then(async (extras) => {
      const form = (extras?.shots ?? []).filter((shot) => shot.kind === 'form');
      const shown = await Promise.all(
        form.map(async ({ path }) => {
          const bytes = await api.readShot(path);
          return bytes ? [{ key: path, url: pictureUrl(bytes, typeOf(path)) }] : [];
        }),
      );
      if (live) setShots((added) => [...shown.flat(), ...added]);
    });
    return () => {
      live = false;
    };
  }, [api, job.id]);

  const addShots = async (files: File[]) => {
    for (const picked of await readPictures(files)) {
      const saved = await api.addShot(
        job.id,
        { name: picked.name, bytes: picked.bytes },
        { kind: 'form' },
      );
      if (!saved.ok) {
        setProblem(saved.message);
        continue;
      }
      setProblem(null);
      setShots((shown) => [...shown, { key: saved.path, url: picked.url }]);
    }
  };

  const removeShot = async (path: string) => {
    const result = await api.removeShot(path);
    if (result.ok) setShots((shown) => shown.filter((shot) => shot.key !== path));
    else setProblem(result.message);
  };

  const save = async (): Promise<EditResult> => {
    const kept = filled(latest.current);
    if (same(kept, saved.current)) return { ok: true };
    const result = await api.updateJob(job.id, { questions: kept });
    if (result.ok) saved.current = kept;
    return result;
  };

  const change = (id: number, text: string) =>
    setBoxes((current) => current.map((each) => (each.id === id ? { id, text } : each)));

  const add = () => {
    setBoxes((current) => [...current, box()]);
    setFocus(boxes.length);
  };

  // The next box takes the removed one's place, or the one before when it was last.
  const remove = (index: number) => {
    setBoxes((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : [box()]));
    setFocus(Math.max(0, Math.min(index, boxes.length - 2)));
  };

  const answer = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (filled(questions).length === 0 && shots.length === 0) {
      setProblem('Paste at least one question, or a screenshot of them, first.');
      setFocus(0);
      return;
    }
    setSaving(true);
    const result = await save();
    setSaving(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    close();
    onAnswer();
  };

  return (
    <Dialog
      title="Application questions"
      description={`Paste each question from ${job.company}’s application, one per box, or screenshots of the form. Your Claude answers them in your own voice, backed by your facts.`}
      onClose={() => {
        void save();
        onClose();
      }}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => answer(event, close)}>
          <ol ref={list} className={styles.list}>
            {boxes.map(({ id, text }, i) => (
              <li key={id} className={styles.item}>
                <span className={styles.number} aria-hidden="true">
                  {i + 1}.
                </span>
                <TextArea
                  className={styles.box}
                  aria-label={`Question ${i + 1}`}
                  placeholder="Paste a question from the application"
                  maxLength={LIMITS.question}
                  rows={2}
                  value={text}
                  onChange={(event) => change(id, event.target.value)}
                  {...(i === 0 && { 'data-autofocus': true })}
                />
                <IconButton
                  label={`Remove question ${i + 1}`}
                  variant="quiet"
                  size="sm"
                  icon={<X size={14} aria-hidden="true" />}
                  onClick={() => remove(i)}
                />
              </li>
            ))}
          </ol>
          <Button
            className={styles.add}
            size="sm"
            variant="quiet"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={boxes.length >= LIMITS.questions}
            onClick={add}
          >
            Add question
          </Button>
          <Screenshots
            shots={shots}
            platform={api.platform}
            label="Add screenshots of the form"
            onAdd={(files) => void addShots(files)}
            onRemove={(path) => void removeShot(path)}
          />
          <p className={styles.hint}>
            They stay with the job, so you can close this and come back to it.
          </p>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Save for later</Button>
            <Button variant="primary" type="submit" disabled={saving}>
              Answer with Claude
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
