import {
  isAnswered,
  MAX_ROUND_TEXT,
  type NumberAsked,
  type QuestionRound,
  type RoundAnswer,
  type RoundOption,
  type RoundQuestion,
  type RoundReply,
  takesNumber,
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
const MAX_PLACEHOLDER = 200;
const MAX_UNIT = 40;
const MAX_ID = 200;

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

/** An optional number: null when it's absent, undefined when it's anything but a finite one. */
const optionalNumber = (value: unknown): number | null | undefined =>
  value === undefined || value === null
    ? null
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;

/** What a number question takes, if it makes sense: a least no more than its most, a step above 0. */
function numberFrom(value: Record<string, unknown>): NumberAsked | null {
  const min = optionalNumber(value.min);
  const max = optionalNumber(value.max);
  const step = optionalNumber(value.step);
  const start = optionalNumber(value.defaultValue);
  const unit = optionalText(value.unit, MAX_UNIT);
  if (min === undefined || max === undefined || step === undefined || start === undefined) {
    return null;
  }
  if (unit === undefined || (min !== null && max !== null && min > max)) return null;
  if (step !== null && step <= 0) return null;
  return { min, max, step, unit, start };
}

const KINDS = ['choice', 'text', 'number'] as const;

function questionFrom(value: unknown): RoundQuestion | null {
  if (!isRecord(value)) return null;
  const kind = KINDS.find((each) => each === (value.kind ?? 'choice'));
  const question = textUpTo(value.question, MAX_QUESTION);
  const header = optionalText(value.header, MAX_HEADER);
  const description = optionalText(value.description, MAX_DESCRIPTION);
  const placeholder = optionalText(value.placeholder, MAX_PLACEHOLDER);
  const { multiSelect } = value;
  const listed = value.options ?? [];
  if (!kind || !question?.trim() || header === undefined || !Array.isArray(listed)) return null;
  if (description === undefined || placeholder === undefined) return null;
  if (multiSelect !== undefined && typeof multiSelect !== 'boolean') return null;
  // Words and numbers are answers of their own, with nothing to pick from.
  if (listed.length > (kind === 'choice' ? MAX_OPTIONS : 0)) return null;
  const options: RoundOption[] = [];
  for (const each of listed) {
    const option = optionFrom(each);
    if (!option) return null;
    options.push(option);
  }
  if (new Set(options.map((option) => option.label)).size !== options.length) return null;
  const number = kind === 'number' ? numberFrom(value) : null;
  if (kind === 'number' && !number) return null;
  return {
    question,
    header,
    kind,
    description,
    placeholder,
    multiSelect: kind === 'choice' && multiSelect === true,
    options,
    number,
  };
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
 * - one with more questions or options, or longer words, than the dialog shows, or a kind of
 *   question it doesn't know
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
 * its own options, at most one of them, or words of their own, where it takes one answer, a number
 * it takes for a number question, and at least one question answered. The picks come back in the
 * question's order.
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
    if (question.kind === 'number' && other.trim() && !takesNumber(question, other)) return null;
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
