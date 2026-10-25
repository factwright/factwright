import { questionKey } from './answers.ts';
import {
  type ForApplications,
  NO_APPLICATIONS,
  type OnFile,
  type PayAsk,
  type RememberedKind,
  type ResumeOnFile,
  type SentBefore,
} from './fill.ts';
import { type FieldKind, fieldKind } from './forms.ts';
import type { AskedJob } from './inbox.ts';
import type { Job } from './jobs.ts';
import { type KindName, kindNamesIn, kindOfJob } from './kinds.ts';
import { hostOf } from './links.ts';
import { matchJobs } from './matching.ts';
import type { JobFile } from './records.ts';
import type { SentAnswer } from './tracker.ts';

/**
 * What's on file for an application form, as Factwright answers one: the job the form is for, its
 * files to upload, what you sent before, what a resume says of you, and Profile's answers for
 * forms. The app reads them from the workspace on its computer, and the browser extension from
 * the job hunt it reads through sync, so both answer a form alike.
 */

/** How many questions one application can have, as the tracker keeps them. */
export const MOST_QUESTIONS = 50;

/**
 * Profile's files in the workspace that forms ask from: your answers, kept as answers.json, and
 * your work history and education. They sync, unlike the street, postal code and equal-opportunity
 * answers, which the app keeps on its computer alone.
 */
export const PROFILE_FILES = {
  answers: 'about-me/answers.json',
  history: 'about-me/history.json',
} as const;

/** A job, as the extension is told of it. */
export const askedJob = (job: Job): AskedJob => ({
  id: job.id,
  company: job.company,
  role: job.role,
  status: job.status ?? 'new',
  appliedOn: job.appliedOn,
});

/**
 * The job a form is for: the one saved from the same posting, which a Greenhouse, Lever or Ashby
 * form shares with its posting's page, or else the one job at the company with the title the
 * page shows.
 */
export function formJob(jobs: readonly Job[], url: string, company: string, role: string) {
  const matches = matchJobs(jobs, { company, role, link: url });
  const posting = matches.find(({ match }) => match === 'posting');
  if (posting) return posting.job;
  const roles = matches.filter(({ match }) => match === 'role');
  return roles.length === 1 ? (roles[0]?.job ?? null) : null;
}

/** Where you found a job, as "How did you hear about us?" asks it, by where it was saved from. */
export function foundOn(job: Job): string {
  const site = hostOf(job.links[0]?.url ?? job.link ?? '');
  const known: [RegExp, string][] = [
    [/(^|\.)linkedin\.com$/, 'LinkedIn'],
    [/(^|\.)indeed\.[a-z.]+$/, 'Indeed'],
    [/(^|\.)glassdoor\.[a-z.]+$/, 'Glassdoor'],
    [/(^|\.)ziprecruiter\.[a-z.]+$/, 'ZipRecruiter'],
    [/(^|\.)wellfound\.com$/, 'Wellfound'],
    [/(^|\.)builtin[a-z]*\.(com|org)$/, 'Built In'],
    [/^news\.ycombinator\.com$/, 'Hacker News'],
  ];
  if (!site) return '';
  return known.find(([pattern]) => pattern.test(site))?.[1] ?? 'Company website';
}

/** The job a form is for, as what's on file says of it: who it's with, where you found it, where. */
export const onFileJob = (job: Job): NonNullable<OnFile['job']> => ({
  company: job.company,
  foundOn: foundOn(job),
  location: job.location ?? '',
});

/** A kind of job you want, with your target pay for it, as Profile keeps it. */
export interface KindTarget extends KindName {
  targetPay: string;
}

/**
 * Each kind of job you want, with your target pay for it, as Profile keeps them: the first
 * kind's in answers.json, and each other kind's in kinds-of-job.json, by its id, as the app reads
 * them. With one kind, that one alone, with no id or name.
 */
export function kindTargetsIn(answers: unknown, kindsFile: unknown): KindTarget[] {
  const first = profileForForms(answers).targetPay;
  const named = kindNamesIn(kindsFile);
  if (named.length === 0) return [{ id: '', name: '', targetPay: first }];
  const { others } = (typeof kindsFile === 'object' && kindsFile !== null ? kindsFile : {}) as {
    others?: unknown;
  };
  const listed = Array.isArray(others) ? others : [];
  const targetOf = (id: string) => {
    const entry = listed.find(
      (each) => typeof each === 'object' && each !== null && (each as { id?: unknown }).id === id,
    ) as { targetPay?: unknown } | undefined;
    return isText(entry?.targetPay, PROFILE_LIMITS.entry) ? entry.targetPay : '';
  };
  return named.map((kind, at) => ({ ...kind, targetPay: at === 0 ? first : targetOf(kind.id) }));
}

/**
 * The pay to ask for at a job: your own for it, or else your Claude's suggestion for it, or else
 * your target for the kind of job it's under, or for your first kind, for a form with no job
 * saved. Null when there's none.
 */
export function payAskFor(
  job: Pick<Job, 'payAsk' | 'suggestedAsk' | 'kind' | 'kindFound'> | null,
  kinds: readonly KindTarget[],
): PayAsk | null {
  const yours = job?.payAsk?.trim();
  if (yours) return { text: yours, from: 'you', kind: null };
  const claudes = job?.suggestedAsk?.trim();
  if (claudes) return { text: claudes, from: 'claude', kind: null };
  const several = kinds.length > 1;
  const id = job && several ? kindOfJob(job, kinds) : null;
  const kind = kinds.find((each) => each.id === id) ?? kinds[0];
  const target = kind?.targetPay.trim();
  return kind && target ? { text: target, from: 'target', kind: several ? kind.name : null } : null;
}

/** A job's PDFs of a kind, its resume or its cover letter, newest first: the first is uploaded. */
export const jobPdfs = (job: Job, kind: 'resume' | 'cover-letter'): JobFile[] =>
  (kind === 'resume' ? job.files : job.letters)
    .filter((file) => file.format === 'pdf')
    .sort((a, b) => b.modified.localeCompare(a.modified));

/** A plain name for an upload, as a person would name it: "Ana Ruiz - Resume.pdf". */
export function uploadName(you: string, kind: 'resume' | 'cover-letter', file: JobFile): string {
  const name = you.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  if (!name) return file.name;
  return `${name} - ${kind === 'resume' ? 'Resume' : 'Cover Letter'}.pdf`;
}

/** Everything you sent before, newest first, with whose application each was in. */
export function sentBefore(jobs: readonly Job[]): SentBefore[] {
  return jobs
    .flatMap((job) =>
      job.sent.map((each) => ({
        question: each.question,
        text: each.text,
        on: each.on,
        company: job.company,
      })),
    )
    .sort((a, b) => b.on.localeCompare(a.on));
}

/**
 * The answers a form's own questions got, as Mark as applied records them: each question the
 * form asks in its own words, and which time it asks it, for one it asks more than once, and why
 * you're leaving, as you put it for this job, to say the same in its interviews. Never anything
 * else Profile answers, an equal-opportunity or personal answer, agreeing to something, or a
 * blank, whatever the extension sent.
 */
export function sentAnswersOf(
  answers: readonly { question: string; text: string }[],
): { question: string; nth: number; text: string }[] {
  const seen = new Map<string, number>();
  const kept: { question: string; nth: number; text: string }[] = [];
  for (const { question, text } of answers) {
    const key = questionKey(question);
    if (!key || !text.trim()) continue;
    const kind = fieldKind({
      question,
      hint: '',
      control: 'long',
      type: '',
      autocomplete: '',
      name: '',
    });
    if (kind !== 'question' && kind !== 'leaving') continue;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    kept.push({ question, nth, text: text.trim() });
  }
  return kept;
}

/**
 * A job's answers sent, with these in place of what was kept for each before: a question the form
 * asks more than once keeps an answer for each time, by `nth`. Blank text changes nothing, and a
 * new question past as many as a job keeps is left out. Says how many it recorded.
 */
export function withSentAnswers(
  sent: readonly SentAnswer[],
  answers: readonly { question: string; nth: number; text: string }[],
  when: { today: string; now: string },
): { sent: SentAnswer[]; recorded: number } {
  let kept = [...sent];
  let recorded = 0;
  for (const { question, nth, text } of answers) {
    const key = questionKey(question);
    if (!key || !text.trim()) continue;
    const same = (each: SentAnswer) => questionKey(each.question) === key && each.nth === nth;
    const at = kept.findIndex(same);
    if (at < 0 && kept.length >= MOST_QUESTIONS) continue;
    const answer = { question, nth, text, on: when.today, at: when.now };
    kept = at < 0 ? [...kept, answer] : kept.map((each, index) => (index === at ? answer : each));
    recorded += 1;
  }
  return { sent: kept, recorded };
}

/**
 * A job's questions with an application form's added, as keeping the form adds them: each one the
 * job doesn't have yet, as many times as the form asks it, up to as many as a job keeps. Null when
 * the job has them all.
 */
export function withFormQuestions(
  had: readonly string[],
  asked: readonly string[],
): string[] | null {
  const count = (questions: readonly string[]) => {
    const counted = new Map<string, number>();
    for (const question of questions) {
      const key = questionKey(question);
      if (key) counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    return counted;
  };
  const before = count(had);
  const seen = new Map<string, number>();
  const added = asked.filter((question) => {
    const key = questionKey(question);
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    return key !== '' && times > (before.get(key) ?? 0);
  });
  return added.length > 0 ? [...had, ...added].slice(0, MOST_QUESTIONS) : null;
}

/**
 * A resume as the skills write it in resume.json, as far as a form asks of it: the engine's
 * Resume, once its readResume has checked it.
 */
export interface ResumeShape {
  name: string;
  summary: string;
  contact?: {
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
  };
  experience: { title: string; company: string; location?: string; start: string; end: string }[];
  education?: { degree: string; school: string; start?: string; end?: string }[];
  skills?: { category: string; items: string[] }[];
  extra_sections?: { heading: string; items: string[] }[];
}

/** What a resume says of you, as the form filler takes it. */
export function resumeDetails(resume: ResumeShape, from: ResumeOnFile['from']): ResumeOnFile {
  const contact = resume.contact ?? {};
  const now = resume.experience.find((each) =>
    /^(present|current|now|today)$/i.test(each.end.trim()),
  );
  return {
    from,
    name: resume.name.trim(),
    email: contact.email?.trim() ?? '',
    phone: contact.phone?.trim() ?? '',
    location: contact.location?.trim() ?? '',
    linkedin: contact.linkedin?.trim() ?? '',
    website: contact.website?.trim() ?? '',
    company: now?.company ?? '',
    title: now?.title ?? '',
    since: now?.start ?? '',
    positions: resume.experience.map((each) => ({
      company: each.company,
      title: each.title,
      location: each.location ?? '',
      start: each.start,
      end: each.end,
    })),
    education: (resume.education ?? []).map((each) => ({
      school: each.school,
      degree: each.degree,
      start: each.start ?? '',
      end: each.end ?? '',
    })),
    skills: resume.skills ?? [],
    sections: resume.extra_sections ?? [],
    summary: resume.summary,
  };
}

/**
 * The longest line Profile keeps, the longest entry in one of its lists, and the longest answer
 * in a few sentences, as why you're leaving.
 */
const PROFILE_LIMITS = { line: 200, entry: 120, entries: 30, sentences: 1000 } as const;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const line = (value: unknown): string | undefined =>
  isText(value, PROFILE_LIMITS.line) ? value : undefined;

const sentences = (value: unknown): string | undefined =>
  isText(value, PROFILE_LIMITS.sentences) ? value : undefined;

/** The longest answer to a kind of field that Profile keeps: a line, or a few sentences. */
export const keptLength = (kind: FieldKind): number =>
  kind === 'leaving' ? PROFILE_LIMITS.sentences : PROFILE_LIMITS.line;

/** A list of short entries, trimmed, without blanks or repeats. */
function entries(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > PROFILE_LIMITS.entries) return undefined;
  const kept: string[] = [];
  for (const each of value) {
    if (!isText(each, PROFILE_LIMITS.entry)) return undefined;
    const entry = each.trim();
    if (entry && !kept.some((known) => known.toLowerCase() === entry.toLowerCase())) {
      kept.push(entry);
    }
  }
  return kept;
}

/** One of a few answers, or nothing when it isn't one of them. */
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
  options.includes(value as T) ? (value as T) : undefined;

/** Your contact details, as Profile keeps them, as a resume shows them. */
export type ProfileContact = OnFile['you'];

export const NO_CONTACT: ProfileContact = {
  name: '',
  email: '',
  phone: '',
  location: '',
  linkedin: '',
  website: '',
};

/** Your contact details from Profile's answers.json, or undefined when they don't hold up. */
export function readContact(value: unknown): ProfileContact | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const read: Partial<ProfileContact> = {};
  for (const key of Object.keys(NO_CONTACT) as (keyof ProfileContact)[]) {
    const field = line(fields[key] ?? '');
    if (field === undefined) return undefined;
    read[key] = field;
  }
  return read as ProfileContact;
}

/**
 * Profile's answers for applications, each checked, with nothing told for any not there yet, or
 * undefined when one doesn't hold up.
 */
export function readForApplications(value: unknown): ForApplications | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const text = (key: keyof ForApplications) => line(fields[key] ?? '');
  const read = {
    preferredName: text('preferredName'),
    pronouns: text('pronouns'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    github: text('github'),
    countries: entries(fields.countries ?? []),
    sponsorship: oneOf(fields.sponsorship ?? '', ['', 'no', 'later', 'now'] as const),
    over18: oneOf(fields.over18 ?? '', ['', 'yes', 'no'] as const),
    howHeard: text('howHeard'),
    leaving: sentences(fields.leaving ?? ''),
  };
  return Object.values(read).every((each) => each !== undefined)
    ? (read as ForApplications)
    : undefined;
}

/**
 * What Profile's answers say that forms ask: the part of OnFile that's from Profile, and your
 * first kind of job's target pay, which answers.json keeps.
 */
export type ProfileForForms = Pick<
  OnFile,
  'you' | 'applications' | 'authorization' | 'start' | 'relocate'
> & { targetPay: string };

/**
 * What forms ask, from Profile's about-me/answers.json, as the app reads it: each answer that
 * doesn't hold up is nothing told, so one bad edit never loses the rest.
 */
export function profileForForms(value: unknown): ProfileForForms {
  const fields =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const read = <T>(key: string, reader: (value: unknown) => T | undefined, none: T): T =>
    key in fields ? (reader(fields[key]) ?? none) : none;
  return {
    you: read('you', readContact, NO_CONTACT),
    applications: read('applications', readForApplications, NO_APPLICATIONS),
    authorization: read('authorization', line, ''),
    start: read('start', line, ''),
    relocate: read('relocate', (value) => oneOf(value, ['', 'no', 'maybe', 'yes'] as const), ''),
    targetPay: read(
      'targetPay',
      (value) => (isText(value, PROFILE_LIMITS.entry) ? value : undefined),
      '',
    ),
  };
}

/** The parts of Profile's answers that are a line of For applications. */
type ApplicationsLine = Exclude<keyof ForApplications, 'countries' | 'sponsorship' | 'over18'>;

/** Where in Profile's answers.json an answer goes: a part of it and a field there, or the start. */
type ProfilePlace =
  | { part: 'you'; key: keyof ProfileContact }
  | { part: 'applications'; key: ApplicationsLine }
  | { part: 'start' };

/**
 * Where Profile keeps each kind of answer a form asks that it offers to keep for next time, in
 * answers.json, which syncs: your contact details and links, where you live, the answers For
 * applications keeps, and when you can start. Your street, postal code and equal-opportunity
 * answers aren't here: the app keeps them on its computer alone, never in sync.
 */
export const SYNCED_ANSWERS = {
  email: { part: 'you', key: 'email' },
  phone: { part: 'you', key: 'phone' },
  location: { part: 'you', key: 'location' },
  linkedin: { part: 'you', key: 'linkedin' },
  website: { part: 'you', key: 'website' },
  'preferred-name': { part: 'applications', key: 'preferredName' },
  pronouns: { part: 'applications', key: 'pronouns' },
  city: { part: 'applications', key: 'city' },
  region: { part: 'applications', key: 'region' },
  country: { part: 'applications', key: 'country' },
  github: { part: 'applications', key: 'github' },
  'how-heard': { part: 'applications', key: 'howHeard' },
  leaving: { part: 'applications', key: 'leaving' },
  'start-date': { part: 'start' },
} as const satisfies Partial<Record<RememberedKind, ProfilePlace>>;

export type SyncedAnswerKind = keyof typeof SYNCED_ANSWERS;

/** Whether Profile keeps a kind of answer in answers.json, which syncs. */
export const isSyncedAnswer = (kind: FieldKind): kind is SyncedAnswerKind =>
  Object.hasOwn(SYNCED_ANSWERS, kind);

/** What Profile's answers.json says for a kind of answer it keeps there, as the app reads it. */
export function profileAnswer(value: unknown, kind: SyncedAnswerKind): string {
  const profile = profileForForms(value);
  const place: ProfilePlace = SYNCED_ANSWERS[kind];
  if (place.part === 'you') return profile.you[place.key];
  if (place.part === 'applications') return profile.applications[place.key];
  return profile.start;
}

/**
 * Profile's answers.json with new answers in it, each in its place, as the app keeps them: a part
 * an answer goes in is read as the app reads it, so what doesn't hold up there is nothing told,
 * and the rest of the file stays as it is, what this version doesn't know included.
 */
export function withProfileAnswers(
  value: Record<string, unknown>,
  answers: readonly { kind: SyncedAnswerKind; text: string }[],
): Record<string, unknown> {
  const profile = profileForForms(value);
  const object = (part: unknown) =>
    typeof part === 'object' && part !== null && !Array.isArray(part) ? part : {};
  const changed: Record<string, unknown> = {};
  for (const { kind, text } of answers) {
    const place: ProfilePlace = SYNCED_ANSWERS[kind];
    if (place.part === 'start') {
      changed.start = text;
    } else {
      const part = (changed[place.part] ?? {
        ...object(value[place.part]),
        ...profile[place.part],
      }) as Record<string, unknown>;
      part[place.key] = text;
      changed[place.part] = part;
    }
  }
  return { ...value, ...changed };
}
