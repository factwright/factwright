import { Button, Field, Input, SegmentedControl } from '@factwright/ui';
import { Plus } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { type AboutYou, ANSWER_LIMITS, type AnswerChanges } from '../../../shared/about.ts';
import {
  addKind,
  firstKindName,
  hasKinds,
  type KindEdit,
  kindsOf,
  renameKind,
} from '../../../shared/kinds.ts';
import styles from './KindsOfJob.module.css';

/**
 * The kinds of job the user wants, one picked to see and change, and a button to add another.
 * Shown once there's more than one.
 */
export function KindSwitcher({
  answers,
  value,
  onChange,
  onAdd,
}: {
  answers: AboutYou;
  value: string;
  onChange: (id: string) => void;
  onAdd: () => void;
}) {
  const kinds = kindsOf(answers);
  return (
    <div className={styles.switcher}>
      <SegmentedControl
        label="Kinds of job"
        options={kinds.map((kind) => ({ value: kind.id, label: kind.name }))}
        value={value}
        onChange={onChange}
      />
      {kinds.length < ANSWER_LIMITS.kinds && (
        <Button
          size="sm"
          variant="quiet"
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={onAdd}
        >
          Add another
        </Button>
      )}
    </div>
  );
}

/**
 * Adds a kind of job by its name. The first time, it names the jobs the user already described
 * too, so each kind has a name to pick it by.
 */
export function AddKind({
  answers,
  onAdd,
  onCancel,
}: {
  answers: AboutYou;
  /** The changes that add it, and its id, to show it. */
  onAdd: (changes: AnswerChanges, id: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  // The second kind names the jobs the user described so far, too.
  const first = !hasKinds(answers);
  const [firstName, setFirstName] = useState(
    () => answers.firstKind?.name ?? firstKindName(answers),
  );
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (first && !firstName.trim()) {
      setProblem('Name the jobs above too, such as Developer.');
      return;
    }
    const edit = addKind(answers, name, firstName);
    if (!edit.ok) {
      setProblem(edit.message);
      return;
    }
    onAdd(edit.changes, edit.changes.otherKinds?.at(-1)?.id ?? '');
  };

  return (
    <form className={styles.adding} aria-labelledby={titleId} onSubmit={add}>
      <div>
        <h4 id={titleId} className={styles.title}>
          Add another kind of job
        </h4>
        <p className={styles.lead}>
          Each kind of job has its own titles, kinds of work, levels and pay, and its own starting
          resumes. Where, companies, terms and deal-breakers stay shared.
        </p>
      </div>
      <div className={styles.names}>
        {first && (
          <Field label="What to call the jobs above">
            {(control) => (
              <Input
                {...control}
                value={firstName}
                maxLength={ANSWER_LIMITS.kindName}
                placeholder="Such as Developer"
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setProblem(null);
                }}
              />
            )}
          </Field>
        )}
        <Field label={first ? 'What to call the new kind' : 'What to call it'}>
          {(control) => (
            <Input
              {...control}
              // Focus goes to the one thing to fill in, as when a dialog opens.
              autoFocus
              value={name}
              maxLength={ANSWER_LIMITS.kindName}
              placeholder="Such as Project manager"
              aria-invalid={problem !== null}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
            />
          )}
        </Field>
      </div>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Add
        </Button>
      </div>
    </form>
  );
}

/**
 * A kind of job's name, changed as the user types. A name that won't do, such as one another
 * kind has, stays on screen with why, and isn't saved until it will.
 */
export function KindName({
  answers,
  id,
  name,
  update,
}: {
  answers: AboutYou;
  id: string;
  name: string;
  update: (changes: AnswerChanges) => void;
}) {
  const [typed, setTyped] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = useId();
  // Another kind picked, or the name changed elsewhere: show it as it is now.
  useEffect(() => {
    setTyped(name);
    setProblem(null);
  }, [name]);

  const change = (text: string) => {
    setTyped(text);
    const edit: KindEdit = renameKind(answers, id, text);
    setProblem(edit.ok ? null : edit.message);
    if (edit.ok) update(edit.changes);
  };

  return (
    <Field label="Name">
      {(control) => (
        <>
          <Input
            {...control}
            className={styles.name}
            value={typed}
            maxLength={ANSWER_LIMITS.kindName}
            aria-invalid={problem !== null}
            aria-describedby={problem ? hintId : undefined}
            onChange={(event) => change(event.target.value)}
          />
          {problem && (
            <p id={hintId} className={styles.problem} role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </Field>
  );
}

/** Removes a kind of job after the first, once the user says so, saying what becomes of it. */
export function RemoveKind({
  name,
  firstName,
  onRemove,
}: {
  name: string;
  firstName: string;
  onRemove: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  // Keeping it puts focus back on the button that asked.
  useEffect(() => {
    if (asking || !kept.current) return;
    kept.current = false;
    button.current?.focus();
  }, [asking]);
  if (!asking) {
    return (
      <div className={styles.remove}>
        <Button ref={button} size="sm" variant="quiet" onClick={() => setAsking(true)}>
          Remove {name}
        </Button>
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of two buttons, not a form.
    <div className={styles.confirm} role="group" aria-label={`Remove ${name}?`}>
      <p className={styles.lead}>
        Remove {name}? Its jobs move to {firstName}, and its starting resumes stay in your
        workspace.
      </p>
      <div className={styles.actions}>
        <Button size="sm" variant="primary" onClick={onRemove}>
          Remove
        </Button>
        {/* Focus moves to the safe choice, as the button that asked has gone. */}
        <Button
          size="sm"
          variant="quiet"
          autoFocus
          onClick={() => {
            kept.current = true;
            setAsking(false);
          }}
        >
          Keep it
        </Button>
      </div>
    </div>
  );
}
