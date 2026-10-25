import { oneLine } from '@factwright/core';
import { SKIPPED_ANSWER } from '../../shared/rounds.ts';

/** A question the user answered in a run, as Claude Code's hooks reported it. */
export interface Answered {
  /** The question, as the user saw it, on one line. */
  question: string;
  /** What the user picked or typed. Several picks are joined with ", ", as Claude Code joins them. */
  answer: string;
  /** What the pick they made says under it, in the dialog, when it says anything. */
  detail: string | null;
  /** What the user added to their pick in its notes, if anything. */
  notes: string | null;
}

/** A question answered in a run, with how much it has backed, so each answer backs little. */
interface Heard extends Answered {
  key: string;
  /** How many facts, rows of what the user doesn't have, and verified facts it has backed. */
  backed: { fact: number; gap: number; verify: number };
}

/** What one answer may back, at most: a fact per option a question can have, one gap, one fact verified. */
export const MAX_BACKED = { fact: 4, gap: 1, verify: 1 } as const;

export type Backing = keyof typeof MAX_BACKED;

/**
 * The tools that file what the user answered, by their names in Claude Code. A call to one counts
 * only once Claude Code's PreToolUse hook has shown it, from the run's own Claude.
 */
export const FILING_TOOLS = ['save_fact', 'save_gap', 'verify_fact', 'correct_fact'] as const;

export type FilingTool = (typeof FILING_TOOLS)[number];

/** A tool's name as Claude Code gives it to hooks, such as mcp__factwright__save_fact. */
export const hookToolName = (tool: FilingTool) => `mcp__factwright__${tool}`;

/**
 * The fields a question round only has once someone has answered it. Claude never sets them:
 * when the questions it sends carry one, something other than the user answered.
 */
export const ANSWER_FIELDS = ['answers', 'annotations', 'response', 'followUp'];

/** As much as Claude Code itself lets a question, an answer or a note be, and a little more. */
const MAX_QUESTION = 2_000;
const MAX_ANSWER = 10_000;
const MAX_QUESTIONS = 4;
/** How many rounds a run keeps, newest first, and how many it waits on at once. */
const MAX_HEARD = 200;
const MAX_WAITING = 20;
/** How many filing calls Claude Code has shown and the app hasn't had yet. */
const MAX_SHOWN = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A question's key: its words on one line, in one form and case, so spacing can't tell two apart. */
export const questionKey = (question: string) => oneLine(question).normalize('NFC').toLowerCase();

/** A string of a length, trimmed, or null. */
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

/** How deep a filing call's input can go: the tools take text, and lists of text. */
const MAX_DEPTH = 4;

/**
 * JSON with every object's keys in order, so the same input reads the same however it's sent.
 * Null for an input nested deeper than any filing tool takes.
 */
export function canonical(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value) || isRecord(value)) {
    const entries = Array.isArray(value)
      ? value.map((each) => canonical(each, depth + 1))
      : Object.keys(value)
          .sort()
          .map((key) => {
            const each = canonical(value[key], depth + 1);
            return each === null ? null : `${JSON.stringify(key)}:${each}`;
          });
    if (entries.some((each) => each === null)) return null;
    return Array.isArray(value) ? `[${entries.join(',')}]` : `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A question as Claude asked it: its words exactly, which Claude Code keys the answers by, and its options. */
interface Asked {
  raw: string;
  options: { label: string; description: string | null }[];
}

/**
 * What Claude Code's own hooks say about one run: the questions Claude asked the user and what
 * they answered, and the calls to the tools that file those answers. PreToolUse shows a round's
 * questions as Claude wrote them, before the user sees them, and PostToolUse shows them once the
 * user has answered. The app gets both from Claude Code, not from Claude, so Claude can't make up
 * an answer here, and neither can a job post Claude read. Factwright's tools file a fact from an
 * answer only when it's here, and only for a call Claude Code showed from the run's own Claude,
 * never a subagent's.
 */
export class QuestionLog {
  /** Rounds asked and not answered yet, by the tool call's id, with their questions. */
  private readonly waiting = new Map<string, Asked[]>();
  private readonly heard: Heard[] = [];
  /** Filing calls Claude Code showed from the run's own Claude, by tool, as canonical JSON. */
  private readonly shown: { tool: FilingTool; input: string }[] = [];

  hear(event: unknown): void {
    if (!isRecord(event)) return;
    // Only the run's own Claude asks, and files: a subagent can't ask, and reads pages it might
    // be steered by, so nothing that says it came from one counts.
    if (typeof event.agent_id === 'string' && event.agent_id !== '') return;
    const filing = FILING_TOOLS.find((tool) => event.tool_name === hookToolName(tool));
    if (filing) {
      if (event.hook_event_name === 'PreToolUse') this.showCall(filing, event.tool_input);
      return;
    }
    if (event.tool_name !== 'AskUserQuestion') return;
    const id = text(event.tool_use_id, 200);
    if (!id) return;
    if (event.hook_event_name === 'PreToolUse') this.asked(id, event.tool_input);
    else if (event.hook_event_name === 'PostToolUse') this.answered(id, event);
  }

  /** A filing call Claude Code is about to make, for the tool to find. */
  private showCall(tool: FilingTool, input: unknown): void {
    const shown = isRecord(input) ? canonical(input) : null;
    if (shown === null) return;
    this.shown.push({ tool, input: shown });
    if (this.shown.length > MAX_SHOWN) this.shown.splice(0, this.shown.length - MAX_SHOWN);
  }

  /**
   * Whether Claude Code showed this call from the run's own Claude, which it does before making
   * it. Each showing lets one call through.
   */
  takeCall(tool: FilingTool, input: Record<string, unknown>): boolean {
    const wanted = canonical(input);
    if (wanted === null) return false;
    const at = this.shown.findIndex((each) => each.tool === tool && each.input === wanted);
    if (at < 0) return false;
    this.shown.splice(at, 1);
    return true;
  }

  /** A round Claude is about to ask, as it wrote it. One that came answered already is ignored. */
  private asked(id: string, input: unknown): void {
    this.waiting.delete(id);
    if (!isRecord(input) || ANSWER_FIELDS.some((field) => Object.hasOwn(input, field))) return;
    const asked = Array.isArray(input.questions) ? input.questions : [];
    const questions = asked.flatMap((each): Asked[] => {
      if (!isRecord(each)) return [];
      const raw = each.question;
      if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_QUESTION) return [];
      const options = (Array.isArray(each.options) ? each.options : []).flatMap((option) =>
        isRecord(option) && typeof option.label === 'string'
          ? [{ label: option.label, description: text(option.description, MAX_ANSWER) }]
          : [],
      );
      return [{ raw, options }];
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
    for (const { raw, options } of questions) {
      // Claude Code keys the answers by each question exactly as Claude wrote it.
      const note = notes[raw];
      const answer = answerOf(answers[raw]) ?? (questions.length === 1 && typed ? typed : null);
      // A question the user skipped in the app's dialog has no answer to back anything.
      if (!answer || answer === SKIPPED_ANSWER) continue;
      const picked = options.find((option) => option.label.trim() === answer);
      this.heard.push({
        key: questionKey(raw),
        question: oneLine(raw),
        answer,
        detail: picked?.description ?? null,
        notes: isRecord(note) ? text(note.notes, MAX_ANSWER) : null,
        backed: { fact: 0, gap: 0, verify: 0 },
      });
    }
    if (this.heard.length > MAX_HEARD) this.heard.splice(0, this.heard.length - MAX_HEARD);
  }

  private newest(question: string): Heard | undefined {
    const key = questionKey(question);
    return this.heard.findLast((each) => each.key === key);
  }

  /** The newest answer to a question, by its words, or null when the user wasn't asked it. */
  find(question: string): Answered | null {
    const found = this.newest(question);
    return found
      ? { question: found.question, answer: found.answer, detail: found.detail, notes: found.notes }
      : null;
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

  /**
   * Takes one of what an answer can back, all at once, so two calls at the same moment can't both
   * have the last one. Answers with a way to give it back, if what it backed wasn't saved, or null
   * when the answer has backed as much as it can.
   */
  reserve(question: string, what: Backing): (() => void) | null {
    const found = this.newest(question);
    if (!found || found.backed[what] >= MAX_BACKED[what]) return null;
    found.backed[what] += 1;
    let given = false;
    return () => {
      if (given) return;
      given = true;
      found.backed[what] -= 1;
    };
  }

  /** The questions answered in this run, oldest first, for Claude to give one word for word. */
  questions(): string[] {
    return [...new Set(this.heard.map((each) => each.question))];
  }
}
