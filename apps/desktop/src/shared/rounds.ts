/**
 * A round of questions Claude asks the user at once, with Claude Code's AskUserQuestion tool, as
 * the app's dialog shows it, and what the user answers there. Claude Code keys the answers by each
 * question's words exactly as Claude wrote them, so the words are kept as they came.
 */

/** One of the options Claude offers for a question. */
export interface RoundOption {
  label: string;
  /** What picking it means, under the label, when Claude says. */
  description: string | null;
  /** Something to look at beside it, such as a sketch of a layout, as plain text. */
  preview: string | null;
}

/** One question in a round. */
export interface RoundQuestion {
  /** Its words, exactly as Claude wrote them. */
  question: string;
  /** A short label for it, such as "Experience", when Claude gave one. */
  header: string | null;
  /** Whether the user may pick more than one option. */
  multiSelect: boolean;
  /** The options to pick from. With none, the user answers in their own words. */
  options: RoundOption[];
}

/** A round Claude is waiting on the user to answer, by its tool call's ID. */
export interface QuestionRound {
  id: string;
  questions: RoundQuestion[];
}

/** What the user answered to one question. */
export interface RoundAnswer {
  /** The labels of the options they picked, in the order the question lists them. */
  picks: string[];
  /** Their answer in their own words, in place of an option or beside the ones picked, or "". */
  other: string;
  /** Anything they add for Claude about their answer, or "". */
  note: string;
}

/** The user's answers to a round, one for each of its questions, in its order. */
export type RoundReply = RoundAnswer[];

/** As long as an answer in the user's own words, or a note, can be. */
export const MAX_ROUND_TEXT = 10_000;

/** Whether the user answered a question: an option picked, or words of their own. */
export const isAnswered = (answer: RoundAnswer) =>
  answer.picks.length > 0 || answer.other.trim() !== '';
