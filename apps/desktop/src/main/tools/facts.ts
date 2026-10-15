import {
  answeredClaimText,
  claimParts,
  FACT_TAGS,
  type FactBlock,
  type Job,
  oneLine,
  UNCONFIRMED,
} from '@factwright/core';
import {
  type FactBank,
  type FactResult,
  type FactTarget,
  factFileKind,
  isFactPath,
} from '../../shared/facts.ts';
import type { FactBankFiles } from '../about/facts.ts';
import { type Answered, type Backing, type FilingTool, questionKey } from '../claude/questions.ts';
import type { ToolCall } from './mcp.ts';

/** What the fact tools need: the bank's files, the jobs on file, and today. */
export interface FactToolDeps {
  facts: Pick<FactBankFiles, 'read' | 'fileClaim' | 'addGap' | 'confirm'>;
  jobs: () => readonly Job[];
  today: () => string;
  /** How long to wait for a hook that's on its way. Tests wait less. */
  answerWaitMs?: number | undefined;
}

/** What Claude was doing when it asked, which a fact's source says. */
export const FACT_TASKS = ['resume', 'cover-letter', 'answers', 'interview-prep', 'other'] as const;

export type FactTask = (typeof FACT_TASKS)[number];

/** The answer that lets a run verify a fact: the user's own pick, in a question about it. */
export const VERIFY_ANSWER = 'Use and verify';

/** The answers to offer for a fact that waits to be verified, in this order. */
export const UNVERIFIED_CHOICES = [VERIFY_ANSWER, 'Use this once', "Don't use"] as const;

/** The longest a claim's title, its wording or a detail can be. */
const MAX_TITLE = 120;
const MAX_TEXT = 400;
const MAX_TOPIC = 200;
/** The longest question, and answer with its notes, a fact keeps word for word. */
const MAX_KEPT_QUESTION = 700;
const MAX_KEPT_ANSWER = 1_000;
/** The longest company name a fact's source gives. */
const MAX_COMPANY = 100;
/** A fact rests on one question, or on one and its follow-up. */
const MAX_BACKING = 2;

/** Skills have a table of their own: a skill from an answer goes in its fact's Keywords. */
const SKILLS_FILE = 'facts/skills.md';

/** A text input on one line, or an error naming the field. */
function line(input: Record<string, unknown>, field: string, max: number, required: true): string;
function line(
  input: Record<string, unknown>,
  field: string,
  max: number,
  required: false,
): string | null;
function line(
  input: Record<string, unknown>,
  field: string,
  max: number,
  required: boolean,
): string | null {
  const value = input[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`Give the ${field}.`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`The ${field} should be text.`);
  const text = oneLine(value);
  if (!text && required) throw new Error(`Give the ${field}.`);
  if (text.length > max) throw new Error(`The ${field} should be ${max} characters or fewer.`);
  return text || null;
}

/** One of a list of words, or an error saying which. */
function oneOf<T extends string>(
  input: Record<string, unknown>,
  field: string,
  words: readonly T[],
  required: boolean,
): T | null {
  const value = input[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`Give the ${field}: one of ${words.join(', ')}.`);
    return null;
  }
  if (typeof value !== 'string' || !(words as readonly string[]).includes(value)) {
    throw new Error(`The ${field} should be one of ${words.join(', ')}.`);
  }
  return value as T;
}

/** The questions a fact rests on, as Claude asked them. */
function questionsOf(input: Record<string, unknown>): string[] {
  const value = input.questions;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BACKING) {
    throw new Error(
      'Give questions: the question the user answered, word for word as you asked it, and its follow-up if there was one.',
    );
  }
  return value.map((each) => {
    if (typeof each !== 'string' || !oneLine(each) || each.length > 2_000) {
      throw new Error('Each question should be its words, as you asked it.');
    }
    return each;
  });
}

/** A file of claims a fact from an answer can go in. */
function claimsFile(input: Record<string, unknown>): string {
  const path = line(input, 'file', 300, true);
  if (!isFactPath(path) || factFileKind(path) !== 'claims') {
    throw new Error(
      'Give the file of facts it goes in: the file of the job where the user did it, such as facts/acme-health.md, or facts/projects.md for work outside a job.',
    );
  }
  if (path === SKILLS_FILE) {
    throw new Error(
      'Skills go in a fact’s Keywords. File the fact where the work was done: the job’s file, or facts/projects.md.',
    );
  }
  return path;
}

/** What Claude was doing, in words a fact's source keeps, such as "tailoring a resume for Acme". */
function contextOf(task: FactTask | null, company: string | null): string | null {
  const at = company ? ` for ${company}` : '';
  switch (task) {
    case 'resume':
      return `tailoring a resume${at}`;
    case 'cover-letter':
      return `writing a cover letter${at}`;
    case 'answers':
      return `answering application questions${at}`;
    case 'interview-prep':
      return company ? `getting ready to talk with ${company}` : 'getting ready for an interview';
    default:
      return company ? `working on ${company}` : null;
  }
}

/** The company of the job named, from the tracker, or an error when it isn't on file. */
function companyOf(input: Record<string, unknown>, deps: FactToolDeps): string | null {
  const id = line(input, 'job', 200, false);
  if (!id) return null;
  const job = deps.jobs().find((each) => each.id === id);
  if (!job) throw new Error(`Nothing on file for ${id}. Give the job’s id from job_details.`);
  return oneLine(job.company).slice(0, MAX_COMPANY) || null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lets a call through only once Claude Code's own PreToolUse hook has shown it, from the run's
 * own Claude: a subagent's calls, which a page it reads could steer, are turned away.
 */
async function fromRunsClaude(
  tool: FilingTool,
  input: Record<string, unknown>,
  call: ToolCall,
  waitMs = 1_000,
): Promise<void> {
  for (const until = Date.now() + Math.min(waitMs, 1_000); ; ) {
    if (call.questions.takeCall(tool, input)) return;
    if (Date.now() >= until) {
      throw new Error(
        'Not saved: Factwright files the user’s answers only for your own calls, as Claude Code shows them, never a subagent’s.',
      );
    }
    await wait(100);
  }
}

/** What to say when an answer isn't on record. */
const notAnswered = (question: string) =>
  new Error(
    [
      `Not saved: Factwright has no record of the user answering “${oneLine(question)}” in this run.`,
      'Facts from answers come only from questions you asked with AskUserQuestion, given word for word.',
      'If they told you some other way, such as typing it in a message, ask them with AskUserQuestion first, then save what they say.',
    ].join(' '),
  );

/**
 * Each question's answer, waiting a moment for its hook, with what it backs taken at once, and a
 * way to give that back when nothing's saved.
 */
async function answersTo(
  questions: readonly string[],
  call: ToolCall,
  backing: Backing,
  waitMs: number | undefined,
): Promise<{ answers: Answered[]; giveBack: () => void }> {
  const answers: Answered[] = [];
  const taken: (() => void)[] = [];
  const giveBack = () => {
    for (const release of taken) release();
  };
  try {
    for (const question of questions) {
      const answer = await call.questions.wait(question, waitMs);
      if (!answer) throw notAnswered(question);
      const release = call.questions.reserve(question, backing);
      if (!release) {
        throw new Error(
          `Not saved: the user’s answer to “${oneLine(question)}” has been used for as much as one answer can back. Ask them about this one.`,
        );
      }
      taken.push(release);
      answers.push(answer);
    }
  } catch (error) {
    giveBack();
    throw error;
  }
  return { answers, giveBack };
}

/** An answer as a fact keeps it: what they picked, what that pick said, and any notes. */
const answerText = ({ answer, detail, notes }: Answered) =>
  `${answer}${detail ? `: ${detail}` : ''}${notes ? ` (${notes})` : ''}`;

/** The quotation marks a question can name a fact's title in. */
const QUOTES = [
  ['“', '”'],
  ['"', '"'],
  ['‘', '’'],
  ["'", "'"],
  ['«', '»'],
] as const;

/**
 * Whether a question names a fact by its title, in quotes, as the standing rules ask: "Your fact
 * bank has “Cost dashboards”…". A title that only turns up among other words, such as a short
 * one like "API", doesn't count.
 */
const namesFact = (question: string, title: string) => {
  const asked = questionKey(question);
  const named = questionKey(title);
  return QUOTES.some(([open, close]) => asked.includes(`${open}${named}${close}`));
};

/** An answer that's a plain no, which goes under Doesn't have rather than becoming a fact. */
const PLAIN_NO = /^(?:no|nope|never|none|not really|no,? never)[.!]?$/;

/** An answer that's a plain yes, which is never something the user doesn't have. */
const PLAIN_YES = /^yes\b/;

/** Whether an answer is one of the picks for using a fact that waits, not news of experience. */
const isUseChoice = (answer: string) =>
  UNVERIFIED_CHOICES.some((choice) => questionKey(choice) === questionKey(answer));

/** Words as a search compares them: lowercase, with marks and spacing evened out. */
const words = (text: string) =>
  ` ${oneLine(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()} `;

/** Whether a term, such as "event streaming", is among some text's words. */
const hasTerm = (text: string, term: string) => {
  const wanted = words(term);
  return wanted.trim() !== '' && words(text).includes(wanted);
};

/**
 * The numbers in some text, as a fact states them: "3,000", "~30%", "2M" and "1.5x" count, the
 * digits in a name such as "S3" or "HL7" don't. The pattern takes time in step with the text.
 */
const NUMBER = /(?<![\p{L}\p{N}.,])\d+(?:[.,]\d+)*(?=[kmbx]?(?![\p{L}\p{N}]))/giu;
const numbersIn = (text: string) =>
  new Set([...text.matchAll(NUMBER)].map(([found]) => found.replaceAll(',', '')));

/** Everything the user saw and said in the questions a fact rests on, to check it against. */
const askedText = (answers: readonly Answered[]) =>
  answers.map((each) => `${each.question} ${answerText(each)}`).join(' ');

/** The claims in a file of the bank, by its path. */
const claimsIn = (bank: FactBank, path: string): FactBlock[] =>
  bank.files.find((file) => file.path === path)?.blocks.filter((block) => block.tags) ?? [];

const sameTitle = (a: string, b: string) => questionKey(a) === questionKey(b);

/** A claim as the bank last read it, to change. */
function targetOf(path: string, block: FactBlock, blocks: readonly FactBlock[]): FactTarget {
  const unique = blocks.filter((each) => each.text.trimEnd() === block.text.trimEnd()).length === 1;
  return { path, index: block.index, text: block.text, unique };
}

/** The message for a change the bank refused, as Claude reads it. */
const refused = (result: Extract<FactResult, { ok: false }>) =>
  new Error(`Not saved: ${result.message}`);

/** What a fact may rest on: answers that are news of the user's experience, kept as they were. */
function checkBacking(answers: readonly Answered[]): void {
  for (const each of answers) {
    if (isUseChoice(each.answer)) {
      throw new Error(
        `Not saved: “${each.answer}” answers whether to use a fact, not what the user has done.`,
      );
    }
    if (each.question.length > MAX_KEPT_QUESTION || answerText(each).length > MAX_KEPT_ANSWER) {
      throw new Error(
        'Not saved: that question or answer is too long to keep with a fact. Ask it in fewer words.',
      );
    }
  }
}

/**
 * Files a fact from the user's answers in this run, tagged `unconfirmed` until they verify it,
 * with its source and the questions and answers it rests on as Claude Code reported them. It must
 * be about what was asked, by one of its keywords, and every number in it must be one the user
 * saw or gave. It goes after the file's last claim, or in place of one that waits to be verified,
 * when this run filed it or the user just answered a question naming it. It never changes a
 * confirmed fact.
 */
export async function saveFact(
  input: Record<string, unknown>,
  deps: FactToolDeps,
  call: ToolCall,
): Promise<string> {
  await fromRunsClaude('save_fact', input, call, deps.answerWaitMs);
  const path = claimsFile(input);
  const title = line(input, 'title', MAX_TITLE, true);
  const status = oneOf(input, 'status', FACT_TAGS.status, true) as string;
  const ownership = oneOf(input, 'ownership', FACT_TAGS.ownership, false);
  const confidence = oneOf(input, 'confidence', FACT_TAGS.confidence, true) as string;
  const wording = line(input, 'wording', MAX_TEXT, true);
  const keywords = line(input, 'keywords', MAX_TEXT, true);
  const details = {
    short: line(input, 'short', MAX_TEXT, false),
    numbers: line(input, 'numbers', MAX_TEXT, false),
    say: line(input, 'say', MAX_TEXT, false),
    keywords,
  };
  const replaces = line(input, 'replaces', MAX_TITLE, false);
  const task = oneOf(input, 'task', FACT_TASKS, false);
  const company = companyOf(input, deps);
  const questions = questionsOf(input);
  const { answers, giveBack } = await answersTo(questions, call, 'fact', deps.answerWaitMs);
  try {
    checkBacking(answers);
    const [first] = answers;
    if (first && PLAIN_NO.test(questionKey(first.answer))) {
      throw new Error(
        `Not saved: the user answered “${first.answer}” to “${first.question}”. Save that with save_gap, and claim nothing from it.`,
      );
    }
    const asked = askedText(answers);
    const terms = keywords.split(/[,;]/).map((term) => term.trim());
    if (!terms.some((term) => hasTerm(asked, term))) {
      throw new Error(
        `Not saved: none of its keywords (${keywords}) is in the question or the user’s answer. A fact from an answer is about what you asked: give the term you asked about as a keyword.`,
      );
    }
    const known = numbersIn(asked);
    const stated = [title, wording, details.short, details.numbers]
      .flatMap((each) => [...numbersIn(each ?? '')])
      .find((number) => !known.has(number));
    if (stated) {
      throw new Error(
        `Not saved: ${stated} isn’t in the user’s answer or your question. Leave out a number they didn’t give, or ask them for it.`,
      );
    }

    const bank = deps.facts.read();
    const claims = claimsIn(bank, path);
    let replacing: FactTarget | null = null;
    let replaced: string | null = null;
    if (replaces) {
      const old = claims.find((block) => sameTitle(block.title, replaces));
      if (!old) throw new Error(`Not saved: ${path} has no fact titled “${replaces}”.`);
      if (!old.tags?.includes(UNCONFIRMED)) {
        throw new Error(
          `Not saved: “${old.title}” is verified, and only the user changes a verified fact. Edit it as any file, which they OK, or file this as a fact of its own.`,
        );
      }
      const filedHere = call.filed.facts.some(
        (each) => each.path === path && sameTitle(each.title, old.title),
      );
      const named = answers.some((each) => namesFact(each.question, old.title));
      if (!filedHere && !named) {
        throw new Error(
          `Not saved: “${old.title}” wasn’t filed in this run, and no answer here is about it. To correct it, ask the user about it first, naming it by its title in quotes.`,
        );
      }
      replacing = targetOf(path, old, claims);
      replaced = old.title;
    }
    const taken = claims.find(
      (block) => sameTitle(block.title, title) && block.index !== replacing?.index,
    );
    if (taken) {
      throw new Error(
        `Not saved: ${path} has a fact titled “${taken.title}” already. Give this one a title of its own.`,
      );
    }
    if (!bank.files.some((file) => file.path === path) && path !== 'facts/projects.md') {
      throw new Error(
        `Not saved: there’s no ${path} in the fact bank. File it in a file that’s there, or in facts/projects.md for work outside a job.`,
      );
    }

    const text = answeredClaimText({
      title,
      status,
      ownership,
      confidence,
      wording,
      ...details,
      date: deps.today(),
      context: contextOf(task, company),
      asked: answers.map((each) => ({ question: each.question, answer: answerText(each) })),
    });
    const result = deps.facts.fileClaim(path, text, replacing);
    if (!result.ok) throw refused(result);
    // A fact this run filed, then replaced, counts once.
    call.filed.facts = call.filed.facts.filter(
      (each) => !(each.path === path && replaced && sameTitle(each.title, replaced)),
    );
    call.filed.facts.push({ path, title });
    call.onFiled?.({ facts: [...call.filed.facts], gaps: call.filed.gaps });
    return [
      `${replacing ? 'Replaced' : 'Saved'} “${title}” in ${path}, unverified, from the user’s answer: “${answers.map(answerText).join('”, then “')}”.`,
      'Use it in this run’s work: the user just said it. Say which lines rest on it when you report.',
      'Later runs offer it to the user before using it, until they verify it.',
    ].join(' ');
  } catch (error) {
    giveBack();
    throw error;
  }
}

/**
 * Notes something the user said they don't have, from their answer in this run, as a row of
 * gaps.md's Doesn't have section, so it's never claimed and never asked about again. The topic
 * must be one the question or the answer names.
 */
export async function saveGap(
  input: Record<string, unknown>,
  deps: FactToolDeps,
  call: ToolCall,
): Promise<string> {
  await fromRunsClaude('save_gap', input, call, deps.answerWaitMs);
  const topic = line(input, 'topic', MAX_TOPIC, true);
  const question = line(input, 'question', 2_000, true);
  const task = oneOf(input, 'task', FACT_TASKS, false);
  const company = companyOf(input, deps);
  const { answers, giveBack } = await answersTo([question], call, 'gap', deps.answerWaitMs);
  try {
    checkBacking(answers);
    const [answer] = answers;
    if (!answer) throw notAnswered(question);
    if (PLAIN_YES.test(questionKey(answer.answer))) {
      throw new Error(
        `Not saved: the user answered “${answer.answer}”, a yes. Save what they have with save_fact instead.`,
      );
    }
    if (!hasTerm(askedText(answers), topic)) {
      throw new Error(
        `Not saved: “${topic}” isn’t in the question or the user’s answer. Give the topic in the words you asked about.`,
      );
    }
    const context = contextOf(task, company);
    const result = deps.facts.addGap({
      topic,
      answer: `${answerText(answer)} (asked “${answer.question}”${context ? ` while ${context}` : ''})`,
      date: deps.today(),
    });
    if (!result.ok) throw refused(result);
    if (!result.added) {
      giveBack();
      return `“${topic}” is in facts/gaps.md under Doesn’t have already.`;
    }
    call.filed.gaps += 1;
    call.onFiled?.({ facts: [...call.filed.facts], gaps: call.filed.gaps });
    return `Noted in facts/gaps.md, under Doesn’t have: “${topic}”, from the user’s answer “${answerText(answer)}”. Don’t claim it, and don’t ask about it again.`;
  } catch (error) {
    giveBack();
    throw error;
  }
}

/**
 * Verifies a fact that waits to be verified, when the user picked "Use and verify", and nothing
 * more, in this run's question about it: one that names it by its title, in quotes, and quotes
 * its wording as it reads now, so the user verified the words they saw. Its source becomes the
 * user and today, as when they verify it in the app. A fact this run saved is the user's to
 * verify in the app. A run never verifies a fact any other way.
 */
export async function verifyFact(
  input: Record<string, unknown>,
  deps: FactToolDeps,
  call: ToolCall,
): Promise<string> {
  await fromRunsClaude('verify_fact', input, call, deps.answerWaitMs);
  const path = line(input, 'file', 300, true);
  const title = line(input, 'title', MAX_TITLE, true);
  const question = line(input, 'question', 2_000, true);
  if (!isFactPath(path)) throw new Error('Give the fact’s file, such as facts/acme-health.md.');
  const { answers, giveBack } = await answersTo([question], call, 'verify', deps.answerWaitMs);
  try {
    const [answer] = answers;
    if (!answer) throw notAnswered(question);
    if (questionKey(answer.answer) !== questionKey(VERIFY_ANSWER)) {
      throw new Error(
        `Not verified: the user answered “${answer.answer}”, not “${VERIFY_ANSWER}”. It stays unverified.`,
      );
    }
    if (answer.notes) {
      throw new Error(
        `Not verified: the user added “${answer.notes}”. Correct the fact with save_fact and replaces, and they verify it in the Fact bank.`,
      );
    }
    if (!namesFact(answer.question, title)) {
      throw new Error(
        `Not verified: the question doesn’t name “${title}”. Ask about the fact by its title, in quotes, and quote its wording, so the user knows which one they’re verifying.`,
      );
    }
    if (call.filed.facts.some((each) => each.path === path && sameTitle(each.title, title))) {
      throw new Error(
        `Not verified: “${title}” was saved in this run, from the user’s answer. They verify it in the Fact bank.`,
      );
    }
    const bank = deps.facts.read();
    const claims = claimsIn(bank, path);
    const named = claims.filter((block) => sameTitle(block.title, title));
    const [claim] = named;
    if (!claim) throw new Error(`Not verified: ${path} has no fact titled “${title}”.`);
    if (named.length > 1) {
      throw new Error(`Not verified: ${path} has more than one fact titled “${title}”.`);
    }
    if (!claim.tags?.includes(UNCONFIRMED)) {
      giveBack();
      return `“${claim.title}” is verified already.`;
    }
    // The words the user verified are the words the fact has now, quoted in the question.
    const wording = claimParts(claim).wording.replace(/[.!?]+$/, '');
    if (wording && !questionKey(answer.question).includes(questionKey(wording))) {
      throw new Error(
        `Not verified: the question doesn’t quote what “${claim.title}” says now. Ask again, quoting its wording in full.`,
      );
    }
    const result = deps.facts.confirm(targetOf(path, claim, claims));
    if (!result.ok) throw new Error(`Not verified: ${result.message}`);
    return `Verified “${claim.title}”, on the user’s pick. Use it as any verified fact.`;
  } catch (error) {
    giveBack();
    throw error;
  }
}
