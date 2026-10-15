import { oneLine } from '@factwright/core';

/** A question the user answered in a run, as Claude Code's hooks reported it. */
export interface Answered {
  /** The question, as the user saw it. */
  question: string;
  /** What the user picked or typed. Several picks are joined with ", ", as Claude Code joins them. */
  answer: string;
  /** What the user added to their pick in its notes, if anything. */
  notes: string | null;
}

/** A question asked in a run, with what the app has let it back, so each answer backs little. */
interface Heard extends Answered {
  key: string;
  /** How many facts, rows of what the user doesn't have, and verified facts it has backed. */
  backed: { fact: number; gap: number; verify: number };
}

/** What one answer may back, at most: a fact per option a question can have, one gap, one fact verified. */
export const MAX_BACKED = { fact: 4, gap: 1, verify: 1 } as const;

export type Backing = keyof typeof MAX_BACKED;

/**
 * The fields a question round only has once someone has answered it. Claude never sets them:
 * when the questions it sends carry one, something other than the user answered.
 */
const ANSWER_FIELDS = ['answers', 'annotations', 'response', 'followUp'];

/** As much as Claude Code itself lets a question, an answer or a note be, and a little more. */
const MAX_QUESTION = 2_000;
const MAX_ANSWER = 10_000;
const MAX_QUESTIONS = 4;
/** How many rounds a run keeps, newest first, and how many it waits on at once. */
const MAX_HEARD = 200;
const MAX_WAITING = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A question's key: its words on one line, in one form and case, so spacing can't tell two apart. */
export const questionKey = (question: string) => oneLine(question).normalize('NFC').toLowerCase();

/** A string of a length, or null. */
const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : null;

/** An answer as Claude Code gives it: a string, or several picks as a list. */
function answerOf(value: unknown): string | null {
  if (Array.isArray(value)) {
    const picks = value.filter((pick): pick is string => typeof pick === 'string');
    return picks.length === value.length ? text(picks.join(', '), MAX_ANSWER) : null;
  }
  return text(value, MAX_ANSWER);
}

/**
 * The questions Claude asks the user in one run, and what the user answered, from Claude Code's
 * own hooks: PreToolUse shows the questions as Claude wrote them, before the user sees them, and
 * PostToolUse shows them once the user has answered. The app sends both, not Claude, so Claude
 * can't make up an answer here, and neither can a job post Claude read. Factwright's tools file a
 * fact from an answer only when it's here.
 */
export class QuestionLog {
  /** Rounds asked and not answered yet, by the tool call's id, with their questions as written. */
  private readonly waiting = new Map<string, string[]>();
  private readonly heard: Heard[] = [];

  hear(event: unknown): void {
    if (!isRecord(event) || event.tool_name !== 'AskUserQuestion') return;
    // Only the run's own Claude asks: a subagent can't, so a round that says it came from one
    // isn't one to go by.
    if (event.agent_id !== undefined) return;
    const id = text(event.tool_use_id, 200);
    if (!id) return;
    if (event.hook_event_name === 'PreToolUse') this.asked(id, event.tool_input);
    else if (event.hook_event_name === 'PostToolUse') this.answered(id, event);
  }

  /** A round Claude is about to ask, as it wrote it. One that came answered already is ignored. */
  private asked(id: string, input: unknown): void {
    this.waiting.delete(id);
    if (!isRecord(input) || ANSWER_FIELDS.some((field) => Object.hasOwn(input, field))) return;
    const asked = Array.isArray(input.questions) ? input.questions : [];
    const questions = asked.flatMap((each) => {
      const question = isRecord(each) ? text(each.question, MAX_QUESTION) : null;
      return question ? [question] : [];
    });
    if (questions.length === 0 || asked.length > MAX_QUESTIONS) return;
    this.waiting.set(id, questions);
    // A round that never comes back, such as one the user closed, gives way to newer ones.
    for (const old of this.waiting.keys()) {
      if (this.waiting.size <= MAX_WAITING) break;
      this.waiting.delete(old);
    }
  }

  /** A round the user answered: each question that was asked, with the user's answer. */
  private answered(id: string, event: Record<string, unknown>): void {
    const questions = this.waiting.get(id);
    this.waiting.delete(id);
    if (!questions) return;
    const output = isRecord(event.tool_response) ? event.tool_response : {};
    const input = isRecord(event.tool_input) ? event.tool_input : {};
    // A round that closed itself while the user was away wasn't answered by them.
    if (output.afkTimeoutMs !== undefined || input.afkTimeoutMs !== undefined) return;
    const answers = isRecord(output.answers)
      ? output.answers
      : isRecord(input.answers)
        ? input.answers
        : {};
    const notes = isRecord(output.annotations)
      ? output.annotations
      : isRecord(input.annotations)
        ? input.annotations
        : {};
    // Words typed in place of answering apply to the round's one question, if it had one.
    const typed = text(output.response ?? input.response, MAX_ANSWER);
    for (const question of questions) {
      const note = notes[question];
      const answer =
        answerOf(answers[question]) ?? (questions.length === 1 && typed ? typed : null);
      if (!answer) continue;
      this.heard.push({
        key: questionKey(question),
        question,
        answer,
        notes: isRecord(note) ? text(note.notes, MAX_ANSWER) : null,
        backed: { fact: 0, gap: 0, verify: 0 },
      });
    }
    if (this.heard.length > MAX_HEARD) this.heard.splice(0, this.heard.length - MAX_HEARD);
  }

  /** The newest answer to a question, by its words, or null when the user wasn't asked it. */
  find(question: string): Answered | null {
    const key = questionKey(question);
    const found = this.heard.findLast((each) => each.key === key);
    return found ? { question: found.question, answer: found.answer, notes: found.notes } : null;
  }

  /**
   * The newest answer to a question, once its hook has come in: Claude Code waits on its hooks
   * before Claude reads the answers, but one can take a moment to arrive.
   */
  async wait(question: string, ms = 2_000): Promise<Answered | null> {
    for (const until = Date.now() + ms; ; ) {
      const found = this.find(question);
      if (found || Date.now() >= until) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Whether an answer can back one more of something, without using it up. */
  canBack(question: string, what: Backing): boolean {
    const found = this.heard.findLast((each) => each.key === questionKey(question));
    return found !== undefined && found.backed[what] < MAX_BACKED[what];
  }

  /** Notes that an answer backed something. */
  back(question: string, what: Backing): void {
    const found = this.heard.findLast((each) => each.key === questionKey(question));
    if (found) found.backed[what] += 1;
  }

  /** The questions answered in this run, oldest first, to say which ones a tool can use. */
  questions(): string[] {
    return [...new Set(this.heard.map((each) => each.question))];
  }
}
