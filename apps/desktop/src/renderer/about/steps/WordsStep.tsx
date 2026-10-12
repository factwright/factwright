import { Chip, Field, TagInput, TextArea } from '@factwright/ui';
import { useEffect, useId, useRef } from 'react';
import { ANSWER_LIMITS, wordCount } from '../../../shared/about.ts';
import styles from './steps.module.css';
import words from './WordsStep.module.css';

/** Prompts that start a paragraph, for when the user doesn't know where to begin. */
const PROMPTS = [
  'What I do now',
  'A project I’m proud of',
  'A hard problem I solved',
  'Numbers I remember',
  'Jobs before this one',
  'Side projects',
  'Tools and skills I use',
  'Awards and praise',
  'What coworkers say about me',
  'Volunteering and other work',
  'What I want next',
  'What I’d rather not do again',
] as const;

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/**
 * The user's own words about themselves, as much as they'll write: every job and what they
 * really did, projects, numbers, tools, praise, and what they want next. No polish needed,
 * since Claude sorts it out and nothing goes on a resume until the user confirms it. Also the
 * names that must never reach an employer.
 */
export function WordsStep({
  notes,
  saved,
  onNotes,
  confidential,
  onConfidential,
}: {
  notes: string;
  saved: boolean;
  onNotes: (text: string) => void;
  confidential: string[];
  onConfidential: (names: string[]) => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  // Set when a prompt starts a paragraph, so the cursor goes after it once it's on screen.
  const startedAt = useRef<number | null>(null);

  /** Starts a new paragraph with the prompt, at the end. */
  const begin = (prompt: string) => {
    const start = notes.trimEnd();
    const text = `${start}${start ? '\n\n' : ''}${prompt}: `;
    startedAt.current = text.length;
    onNotes(text);
  };

  useEffect(() => {
    const area = box.current;
    const at = startedAt.current;
    if (!area || at === null || notes.length !== at) return;
    startedAt.current = null;
    area.focus();
    area.setSelectionRange(at, at);
    area.scrollTop = area.scrollHeight;
  }, [notes]);

  const count = wordCount(notes);
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Tell us everything
        </h2>
        <p className={styles.lead}>
          Don’t hold back, and don’t polish. Type whatever comes to mind about your work and your
          life: every job and what you really did there, projects you’re proud of, side projects,
          problems you solved, numbers you remember, tools you know, awards, volunteering, what
          coworkers say about you, and what you want next. Typos and run-on sentences are fine. The
          more you write, the better your fact bank, and nothing goes on a resume until you confirm
          it.
        </p>
      </div>

      <div className={styles.section}>
        <div className={words.prompts}>
          <span className={styles.note}>Need a place to start?</span>
          {PROMPTS.map((prompt) => (
            <Chip key={prompt} pressed={false} onClick={() => begin(prompt)}>
              {prompt}
            </Chip>
          ))}
        </div>
        <Field label="About you, in your own words">
          {(control) => (
            <TextArea
              {...control}
              ref={box}
              className={words.box}
              value={notes}
              maxLength={ANSWER_LIMITS.notes}
              placeholder="I’ve spent the last four years at… The thing I’m proudest of is… Before that I…"
              onChange={(event) => onNotes(event.target.value)}
            />
          )}
        </Field>
        <p className={styles.note} aria-live="polite">
          {plural(count, 'word')}
          {count > 0 && (saved ? ' · Saved' : ' · Saving…')}
          {count > 0 && count < 150 && ' · Keep going: a few hundred words is a great start.'}
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Keep these off your resumes</h3>
        <p className={styles.sectionLead}>
          Names that must never reach an employer: customers, coworkers, internal project names,
          codenames, internal tools. Every resume is checked against this list, and Claude adds to
          it as names come up.
        </p>
        <Field label="Names to keep private" hint="Press Enter after each one.">
          {(control) => (
            <TagInput
              {...control}
              value={confidential}
              onChange={onConfidential}
              placeholder="Such as a customer’s name"
              max={200}
            />
          )}
        </Field>
      </div>
    </section>
  );
}
