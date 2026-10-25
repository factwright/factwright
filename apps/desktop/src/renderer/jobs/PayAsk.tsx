import { type Job, type KindTarget, type PayAsk, payAskFor } from '@factwright/core';
import { Button, Input } from '@factwright/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './PayAsk.module.css';

/** Whose the pay to ask for is, in words, as it shows after the pay. */
function whose(ask: PayAsk): string {
  if (ask.from === 'you') return 'your own';
  if (ask.from === 'claude') return 'your Claude’s suggestion';
  return ask.kind ? `your target for ${ask.kind} jobs` : 'your target';
}

/**
 * The pay to ask for at the job, which Fill types in its application's pay questions: the user's
 * own for it, or else their Claude's suggestion, or else their target pay for its kind of job.
 * Change sets the user's own, which wins over their Claude's, and Use goes back to what it was.
 */
export function PayAskLine({
  job,
  targets,
  api,
}: {
  job: Job;
  /** Each kind of job the user wants, with their target pay for it. */
  targets: readonly KindTarget[];
  api: Pick<FactwrightApi, 'updateJob'>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const change = useRef<HTMLButtonElement>(null);
  // Once the box closes, the keyboard's focus goes back to Change, where it was.
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    change.current?.focus();
  }, [editing]);
  const ask = payAskFor(job, targets);
  // What it goes by without the user's own.
  const instead = job.payAsk ? payAskFor({ ...job, payAsk: null }, targets) : null;
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };

  const save = async (payAsk: string | null) => {
    setSaving(true);
    try {
      const result = await api.updateJob(job.id, { payAsk });
      setProblem(result.ok ? null : result.message);
      if (result.ok) close();
    } catch {
      setProblem('Factwright couldn’t save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className={styles.ask}>
        {/* Change follows the words, as a word of its own, so it wraps with them. */}
        <p>
          <strong>Pay to ask for:</strong>{' '}
          {ask ? (
            <>
              {ask.text}
              <span className={styles.source}>, {whose(ask)}</span>
            </>
          ) : (
            <span className={styles.source}>none yet</span>
          )}{' '}
          <button
            ref={change}
            type="button"
            className={styles.change}
            // The words on the button come first, so a voice command naming them finds it.
            aria-label={`${ask ? 'Change' : 'Set it'}: the pay to ask for at ${job.company}`}
            onClick={() => {
              setText(job.payAsk ?? ask?.text ?? '');
              setProblem(null);
              setEditing(true);
            }}
          >
            {ask ? 'Change' : 'Set it'}
          </button>
        </p>
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      className={styles.edit}
      onSubmit={(event) => {
        event.preventDefault();
        void save(text.trim() || null);
      }}
    >
      <label className={styles.label} htmlFor={inputId}>
        Pay to ask for at {job.company}
      </label>
      <div className={styles.row}>
        <Input
          id={inputId}
          className={styles.input}
          autoFocus
          value={text}
          maxLength={LIMITS.pay}
          placeholder="Such as $185,000"
          // What it goes by now, all picked, so typing another replaces it.
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Escape closes the box, never the job's panel.
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close();
          }}
        />
        <Button size="sm" variant="primary" type="submit" disabled={saving}>
          Save
        </Button>
        <Button size="sm" variant="quiet" onClick={close}>
          Cancel
        </Button>
      </div>
      {job.payAsk && (
        <button
          type="button"
          className={`${styles.change} ${styles.instead}`}
          disabled={saving}
          onClick={() => void save(null)}
        >
          {instead ? `Use ${whose(instead)}, ${instead.text}` : 'Clear it'}
        </button>
      )}
      <p className={styles.hint}>
        Fill types this in pay questions on the job’s application, and picks the range it’s in.
        Yours wins over your Claude’s.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
