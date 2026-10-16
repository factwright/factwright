import {
  isAnswered,
  MAX_ROUND_TEXT,
  type QuestionRound,
  type RoundAnswer,
  type RoundOption,
  type RoundQuestion,
  type RoundReply,
} from '../../shared/rounds.ts';
import { ANSWER_FIELDS } from './questions.ts';

/**
 * As much as a round can hold for the app's dialog. Claude Code asks for 1 to 4 questions of 2 to
 * 4 options each, and the rest are as long as anything Claude writes there could sensibly be. A
 * round with more is asked in the terminal, as before.
 */
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
const MAX_QUESTION = 2_000;
const MAX_HEADER = 100;
const MAX_LABEL = 500;
const MAX_DESCRIPTION = 2_000;
const MAX_PREVIEW = 20_000;
const MAX_ID = 200;
/** How many rounds can wait at once, past which the oldest goes to the terminal. */
const MAX_WAITING = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string within a length, as it came, or null when it's anything else. */
const textUpTo = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null;

/** An optional string within a length: null when it's absent or blank, undefined when it's wrong. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  const text = textUpTo(value, max);
  if (text === null) return undefined;
  return text.trim() === '' ? null : text;
}

function optionFrom(value: unknown): RoundOption | null {
  if (!isRecord(value)) return null;
  const label = textUpTo(value.label, MAX_LABEL);
  const description = optionalText(value.description, MAX_DESCRIPTION);
  const preview = optionalText(value.preview, MAX_PREVIEW);
  if (!label?.trim() || description === undefined || preview === undefined) return null;
  return { label, description, preview };
}

function questionFrom(value: unknown): RoundQuestion | null {
  if (!isRecord(value)) return null;
  // Claude Code can ask for a number or a line of text too, in ways of its own, so those stay
  // in the terminal.
  if (value.kind !== undefined && value.kind !== 'choice') return null;
  const question = textUpTo(value.question, MAX_QUESTION);
  const header = optionalText(value.header, MAX_HEADER);
  const { multiSelect } = value;
  const listed = value.options ?? [];
  if (!question?.trim() || header === undefined || !Array.isArray(listed)) return null;
  if (multiSelect !== undefined && typeof multiSelect !== 'boolean') return null;
  if (listed.length > MAX_OPTIONS) return null;
  const options: RoundOption[] = [];
  for (const each of listed) {
    const option = optionFrom(each);
    if (!option) return null;
    options.push(option);
  }
  if (new Set(options.map((option) => option.label)).size !== options.length) return null;
  return { question, header, multiSelect: multiSelect === true, options };
}

/** A round from a hook, for the dialog, with the input Claude Code gave, which its answer goes back with. */
export interface HeardRound {
  round: QuestionRound;
  input: Record<string, unknown>;
}

/**
 * The round of questions a PreToolUse hook says Claude is about to ask, for the app's dialog.
 * Null for any other hook, and for a round the dialog leaves to the terminal, as before:
 * - one from a subagent, which only the run's own Claude may ask
 * - one that comes with answers already, which Claude never sets, so something else did
 * - one with more questions or options, longer words, or kinds of question, than the dialog shows
 */
export function roundFrom(event: unknown): HeardRound | null {
  if (!isRecord(event)) return null;
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'AskUserQuestion') return null;
  if (typeof event.agent_id === 'string' && event.agent_id !== '') return null;
  const id = textUpTo(event.tool_use_id, MAX_ID);
  const input = event.tool_input;
  if (!id || !isRecord(input) || ANSWER_FIELDS.some((field) => Object.hasOwn(input, field))) {
    return null;
  }
  const asked = input.questions;
  if (!Array.isArray(asked) || asked.length === 0 || asked.length > MAX_QUESTIONS) return null;
  const questions: RoundQuestion[] = [];
  for (const each of asked) {
    const question = questionFrom(each);
    if (!question) return null;
    questions.push(question);
  }
  // Claude Code keys the answers by each question's words, so no two can share them.
  if (new Set(questions.map((each) => each.question)).size !== questions.length) return null;
  return { round: { id, questions }, input };
}

/**
 * The user's answers from the window, if they fit the round: one for each question, picking only
 * its own options, at most one of them, or words of their own, where it takes one answer, and at
 * least one question answered. The picks come back in the question's order.
 */
export function parseReply(round: QuestionRound, value: unknown): RoundReply | null {
  if (!Array.isArray(value) || value.length !== round.questions.length) return null;
  const reply: RoundAnswer[] = [];
  for (const [at, question] of round.questions.entries()) {
    const given = value[at];
    if (!isRecord(given) || !Array.isArray(given.picks)) return null;
    const other = textUpTo(given.other, MAX_ROUND_TEXT);
    const note = textUpTo(given.note, MAX_ROUND_TEXT);
    if (other === null || note === null) return null;
    const picks = given.picks;
    const labels = question.options.map((option) => option.label);
    if (!picks.every((pick) => typeof pick === 'string' && labels.includes(pick))) return null;
    if (new Set(picks).size !== picks.length) return null;
    const answer = { picks: labels.filter((label) => picks.includes(label)), other, note };
    if (!question.multiSelect && answer.picks.length + (other.trim() ? 1 : 0) > 1) return null;
    reply.push(answer);
  }
  return reply.some(isAnswered) ? reply : null;
}

/** An answer as Claude Code passes it on: what was picked, then the user's own words, with ", ". */
const answerText = ({ picks, other }: RoundAnswer) =>
  [...picks, other.trim()].filter((part) => part !== '').join(', ');

/**
 * What the question hook answers Claude Code with once the user answers in the app's dialog, as
 * Claude Code's documentation says: "allow", with the round as Claude Code gave it and the answers
 * by each question's words, so Claude Code runs AskUserQuestion with them and asks nothing in the
 * terminal. A note goes with its answer, and so does the preview of the one option picked, as
 * Claude Code's own dialog sends them. A question left unanswered has no answer.
 */
export function hookReply(heard: HeardRound, reply: RoundReply) {
  const answers: Record<string, string> = {};
  const annotations: Record<string, { notes?: string; preview?: string }> = {};
  for (const [at, { question, options }] of heard.round.questions.entries()) {
    const answer = reply[at];
    if (!answer) continue;
    const text = answerText(answer);
    if (text) answers[question] = text;
    const note = answer.note.trim();
    const [picked] = answer.picks;
    const preview =
      answer.picks.length === 1 && options.find((option) => option.label === picked)?.preview;
    if (note || preview) {
      annotations[question] = { ...(preview && { preview }), ...(note && { notes: note }) };
    }
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        ...heard.input,
        answers,
        ...(Object.keys(annotations).length > 0 && { annotations }),
      },
    },
  };
}

/** A round waiting on the user, with what settles it. */
interface Waiting {
  round: QuestionRound;
  settle: (reply: RoundReply | null) => void;
}

/**
 * The rounds of Claude's questions waiting on the user in the app, oldest first, which the window
 * shows one at a time. Each waits until the user answers it, sends it to the terminal, or Claude
 * Code stops waiting, as when the user interrupts the run, the hook's time runs out, or the run
 * ends.
 */
export class QuestionDesk {
  private readonly waiting: Waiting[] = [];
  private readonly show: (round: QuestionRound | null) => void;

  /** `show` hears the round the window should show, or null once none is waiting. */
  constructor(show: (round: QuestionRound | null) => void) {
    this.show = show;
  }

  /**
   * Waits for the user's answers to a round, or null to have Claude Code ask it in the terminal,
   * which is also what an aborted wait settles with.
   */
  ask(round: QuestionRound, signal: AbortSignal): Promise<RoundReply | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const entry: Waiting = {
        round,
        settle: (reply) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', stopped);
          const shown = this.current();
          const at = this.waiting.indexOf(entry);
          if (at >= 0) this.waiting.splice(at, 1);
          resolve(reply);
          if (this.current() !== shown) this.show(this.current());
        },
      };
      const stopped = () => entry.settle(null);
      signal.addEventListener('abort', stopped, { once: true });
      // The same call asked again replaces the one before, whose hook has gone.
      this.waiting.find((each) => each.round.id === round.id)?.settle(null);
      this.waiting.push(entry);
      while (this.waiting.length > MAX_WAITING) this.waiting[0]?.settle(null);
      if (this.current() === round) this.show(round);
    });
  }

  /** The round the window shows: the oldest one waiting, or null. */
  current(): QuestionRound | null {
    return this.waiting[0]?.round ?? null;
  }

  /** A round that's waiting, by its ID, or null. */
  find(id: string): QuestionRound | null {
    return this.waiting.find((each) => each.round.id === id)?.round ?? null;
  }

  /**
   * Settles a round with the user's answers, or null to send it to the terminal. False when it
   * isn't waiting anymore.
   */
  answer(id: string, reply: RoundReply | null): boolean {
    const entry = this.waiting.find((each) => each.round.id === id);
    entry?.settle(reply);
    return entry !== undefined;
  }
}
