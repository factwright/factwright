import { Button, Dialog, DialogActions, Input, MarkdownLine, Pill, TextArea } from '@factwright/ui';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  isAnswered,
  MAX_ROUND_TEXT,
  type QuestionRound,
  type RoundAnswer,
  type RoundQuestion,
  type RoundReply,
  takesNumber,
} from '../shared/rounds.ts';
import styles from './ClaudeQuestions.module.css';
import type { Choice } from './useClaudeQuestions.ts';

const startChoice = (question: RoundQuestion): Choice => ({
  picks: [],
  // A number question starts at the number Claude suggests, if it gave one.
  other: question.number?.start == null ? '' : String(question.number.start),
  otherOn: question.options.length === 0,
  note: '',
  noting: false,
});

/** A number question's range, in words, such as "a number from 0 to 40". */
function rangeWords(question: RoundQuestion): string {
  const { min = null, max = null } = question.number ?? {};
  if (min !== null && max !== null) return `a number from ${min} to ${max}`;
  if (min !== null) return `a number of at least ${min}`;
  if (max !== null) return `a number of at most ${max}`;
  return 'a number';
}

/** A choice as the answer Claude gets. */
const answerOf = (choice: Choice): RoundAnswer => ({
  picks: choice.picks,
  other: choice.otherOn ? choice.other : '',
  note: choice.note,
});

/** A preview as plain text, without the code fence Claude may wrap it in. */
const previewText = (preview: string) =>
  preview.replace(/^\s*```[^\n]*\n/, '').replace(/\n```\s*$/, '');

const count = (n: number) => (n === 1 ? 'a question' : `${n} questions`);

/**
 * A round of questions from the user's Claude, in a dialog over the app rather than in the
 * terminal: all of them at once, each with its options and what they mean, the user's own words
 * where none fits, and a note for Claude. The answers go straight to their Claude Code, which
 * notes them in the panel as it would have. Not now puts the round aside, still waiting, with
 * what the user chose so far, and Answer in the terminal has Claude Code ask it there instead.
 */
export function ClaudeQuestions({
  api,
  round,
  about,
  draft = null,
  onDraft,
  onClose,
}: {
  api: Pick<FactwrightApi, 'answerClaude'>;
  round: QuestionRound;
  /** What the run is for, such as "Tailored resume · Acme Robotics", or null for a plain run. */
  about: string | null;
  /** What the user chose before they put the round aside, to carry on from. */
  draft?: Choice[] | null;
  /** Hears each change to what the user has chosen, to keep it while the round is put aside. */
  onDraft?: (choices: Choice[]) => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState(() =>
    draft?.length === round.questions.length ? draft : round.questions.map(startChoice),
  );
  useEffect(() => onDraft?.(choices), [choices, onDraft]);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const answers = choices.map(answerOf);
  const answered = answers.filter(isAnswered).length;
  const unanswered = round.questions.length - answered;
  // A number Claude Code wouldn't take, such as one past the question's most, can't be sent.
  const wrongNumber = round.questions.some((question, at) => {
    const other = answers[at]?.other ?? '';
    return question.kind === 'number' && other.trim() !== '' && !takesNumber(question, other);
  });
  const change = (at: number, changes: Partial<Choice>) =>
    setChoices((current) =>
      current.map((choice, index) => (index === at ? { ...choice, ...changes } : choice)),
    );

  const reply = async (close: () => void, given: RoundReply | 'terminal') => {
    setSending(true);
    setProblem(null);
    const result = await api.answerClaude(round.id, given).catch(() => ({
      ok: false as const,
      message: 'Your answers didn’t reach Claude. Try again.',
    }));
    setSending(false);
    if (result.ok) close();
    else setProblem(result.message);
  };
  const send = (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (answered > 0 && !wrongNumber && !sending) void reply(close, answers);
  };
  // Enter in a box or on an option sends the round only once every question has an answer, so it
  // never sends half of one by accident. Send still sends what's answered.
  const holdEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && unanswered > 0) {
      event.preventDefault();
    }
  };

  return (
    <Dialog
      title={`Claude has ${count(round.questions.length)}`}
      description={
        about ? `From your Claude, working on ${about}.` : 'From your Claude, in its panel below.'
      }
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <form onSubmit={(event) => send(event, close)} onKeyDown={holdEnter}>
          <div className={styles.questions}>
            {round.questions.map((question, at) => (
              <QuestionField
                key={question.question}
                question={question}
                choice={choices[at] ?? startChoice(question)}
                first={at === 0}
                onChange={(changes) => change(at, changes)}
              />
            ))}
          </div>
          <div className={styles.footer}>
            {answered > 0 && unanswered > 0 && (
              <p className={styles.unanswered}>
                {unanswered === 1 ? 'One question has' : `${unanswered} questions have`} no answer.
                Claude carries on without {unanswered === 1 ? 'it' : 'them'}.
              </p>
            )}
            {problem && (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            )}
            <DialogActions>
              <Button
                variant="quiet"
                className={styles.terminal}
                disabled={sending}
                onClick={() => void reply(close, 'terminal')}
              >
                Answer in the terminal
              </Button>
              <Button onClick={close}>Not now</Button>
              <Button
                variant="primary"
                type="submit"
                disabled={sending || answered === 0 || wrongNumber}
              >
                {round.questions.length === 1 ? 'Send answer' : 'Send answers'}
              </Button>
            </DialogActions>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** One question: its options to pick from, the user's own answer, and a note for Claude. */
function QuestionField({
  question,
  choice,
  first,
  onChange,
}: {
  question: RoundQuestion;
  choice: Choice;
  /** The first question, whose first option starts with the focus. */
  first: boolean;
  onChange: (changes: Partial<Choice>) => void;
}) {
  const { multiSelect, options } = question;
  const kind = multiSelect ? 'checkbox' : 'radio';
  const otherBox = useRef<HTMLInputElement>(null);
  // Each option is named by its label alone, and described by what it means.
  const ids = useId();
  const pick = (label: string) => {
    if (!multiSelect) {
      onChange({ picks: [label], otherOn: false });
      return;
    }
    const on = choice.picks.includes(label);
    onChange({
      picks: options
        .map((option) => option.label)
        .filter((each) => (each === label ? !on : choice.picks.includes(each))),
    });
  };
  const chooseOther = (on: boolean) =>
    onChange(multiSelect ? { otherOn: on } : { otherOn: on, picks: on ? [] : choice.picks });
  return (
    <fieldset className={styles.question}>
      <legend className={styles.legend}>
        {question.header && (
          <Pill tone="blue" className={styles.header}>
            {question.header}
          </Pill>
        )}
        <span className={styles.text}>
          <MarkdownLine text={question.question} />
        </span>
      </legend>
      {question.description && (
        <p className={styles.about}>
          <MarkdownLine text={question.description} />
        </p>
      )}
      {multiSelect && <p className={styles.hint}>Pick any that apply.</p>}
      <div className={styles.options}>
        {options.map((option, index) => {
          const picked = choice.picks.includes(option.label);
          return (
            <label key={option.label} className={`${styles.option} ${picked ? styles.picked : ''}`}>
              <input
                type={kind}
                name={question.question}
                checked={picked}
                onChange={() => pick(option.label)}
                aria-labelledby={`${ids}-label-${index}`}
                aria-describedby={option.description ? `${ids}-about-${index}` : undefined}
                {...(first && index === 0 && { 'data-autofocus': true })}
              />
              <span className={styles.words}>
                <span id={`${ids}-label-${index}`} className={styles.label}>
                  {option.label}
                </span>
                {option.description && (
                  <span id={`${ids}-about-${index}`} className={styles.description}>
                    <MarkdownLine text={option.description} />
                  </span>
                )}
                {option.preview && picked && (
                  <pre className={styles.preview}>{previewText(option.preview)}</pre>
                )}
              </span>
            </label>
          );
        })}
        {question.kind === 'number' ? (
          <NumberBox
            question={question}
            value={choice.other}
            first={first}
            onChange={(other) => onChange({ other })}
          />
        ) : options.length === 0 ? (
          <TextArea
            className={styles.own}
            aria-label="Your answer"
            placeholder={question.placeholder ?? 'Your answer'}
            rows={3}
            maxLength={MAX_ROUND_TEXT}
            value={choice.other}
            onChange={(event) => onChange({ other: event.target.value })}
            {...(first && { 'data-autofocus': true })}
          />
        ) : (
          <div
            className={`${styles.option} ${styles.otherRow} ${choice.otherOn ? styles.picked : ''}`}
          >
            <input
              type={kind}
              name={question.question}
              aria-label="Something else"
              checked={choice.otherOn}
              onChange={() => chooseOther(!(multiSelect && choice.otherOn))}
              // Clicking their own answer is for typing it. Arrow keys move on through the
              // options instead, as they do in any group of them.
              onClick={(event) => {
                if (event.detail > 0 && event.currentTarget.checked) otherBox.current?.focus();
              }}
            />
            <Input
              ref={otherBox}
              className={styles.otherBox}
              aria-label="Something else, in your words"
              placeholder="Something else…"
              maxLength={MAX_ROUND_TEXT}
              value={choice.other}
              onChange={(event) => {
                const other = event.target.value;
                onChange(
                  multiSelect || other.trim() === ''
                    ? { other, otherOn: other.trim() !== '' || (multiSelect && choice.otherOn) }
                    : { other, otherOn: true, picks: [] },
                );
              }}
            />
          </div>
        )}
      </div>
      {choice.noting ? (
        <TextArea
          className={styles.note}
          aria-label="Note for Claude"
          placeholder="Anything Claude should know about your answer"
          rows={2}
          maxLength={MAX_ROUND_TEXT}
          value={choice.note}
          // The user just asked for the box, to type in it.
          autoFocus
          onChange={(event) => onChange({ note: event.target.value })}
        />
      ) : (
        <button type="button" className={styles.addNote} onClick={() => onChange({ noting: true })}>
          Add a note
        </button>
      )}
    </fieldset>
  );
}

/** A number question's box, with its unit, saying when the number isn't one the question takes. */
function NumberBox({
  question,
  value,
  first,
  onChange,
}: {
  question: RoundQuestion;
  value: string;
  first: boolean;
  onChange: (value: string) => void;
}) {
  const wrongId = useId();
  const { min = null, max = null, step = null, unit = null } = question.number ?? {};
  const wrong = value.trim() !== '' && !takesNumber(question, value);
  return (
    <div className={styles.numberRow}>
      <Input
        type="number"
        inputMode="decimal"
        className={styles.numberBox}
        aria-label={unit ? `Your answer, in ${unit}` : 'Your answer'}
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? wrongId : undefined}
        placeholder={question.placeholder ?? undefined}
        min={min ?? undefined}
        max={max ?? undefined}
        step={step ?? 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...(first && { 'data-autofocus': true })}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
      {wrong && (
        <p id={wrongId} className={styles.wrong} role="alert">
          Give {rangeWords(question)}.
        </p>
      )}
    </div>
  );
}
