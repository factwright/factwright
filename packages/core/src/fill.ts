import { questionKey, type SuggestedAnswer } from './answers.ts';
import {
  countriesOfPlace,
  countryCode,
  countryName,
  countryNames,
  placesIn,
  US_STATES,
} from './countries.ts';
import { shortDate } from './format.ts';
import {
  type FieldKind,
  type FormField,
  fieldKind,
  fieldPart,
  isEqualOpportunity,
  WITHOUT_SPONSORSHIP,
} from './forms.ts';
import {
  type HeldPosition,
  monthNames,
  positionsOf,
  type School,
  typedDate,
  type WorkHistory,
  yearOf,
} from './history.ts';
import { parsePay } from './pay.ts';

/**
 * Answering an application form from what's on file, field by field: Profile first, then the
 * job's own resume and letter, or your newest resume where Profile is blank or the job has none
 * yet, then what you sent before, then your Claude's drafts for the job.
 * Anything else is left for you. Equal-opportunity questions are answered only from what you set
 * in Profile, personal questions never, and passwords, payment details, ID numbers and dates of
 * birth never.
 */

/**
 * Profile's part for applications: what forms ask that a resume doesn't say. It's kept with the
 * rest of Profile, so it syncs, and Claude can read it. Your street, postal code and
 * equal-opportunity answers are kept apart (KeptPrivate).
 */
export interface ForApplications {
  /** The first name you go by, if it isn't the one on your resume. */
  preferredName: string;
  /** Such as "she/her". */
  pronouns: string;
  city: string;
  /** Your state, province or region, such as "CO" or "Colorado". */
  region: string;
  country: string;
  /** Your GitHub, for forms that ask, such as "https://github.com/you". */
  github: string;
  /** The countries you can work in without a visa, such as "United States". */
  countries: string[];
  /** Whether you'll need a visa sponsored to work there: never, later, now, or unset. */
  sponsorship: '' | 'no' | 'later' | 'now';
  /** Whether you're 18 or older, for forms that ask: unset leaves it for you. */
  over18: '' | 'yes' | 'no';
  /** What to say to "How did you hear about us?" when where you found the job doesn't say. */
  howHeard: string;
}

/**
 * What Profile keeps for applications on this computer alone, outside the workspace: never synced,
 * and never where Claude's tools reach.
 */
export interface KeptPrivate {
  street: string;
  postalCode: string;
  equalOpportunity: EqualOpportunity;
}

/** The equal-opportunity answers, each one "" to leave it for you, or the answer you chose. */
export interface EqualOpportunity {
  gender: '' | 'woman' | 'man' | 'non-binary' | 'decline';
  hispanic: '' | 'yes' | 'no' | 'decline';
  race:
    | ''
    | 'american-indian'
    | 'asian'
    | 'black'
    | 'hispanic'
    | 'pacific-islander'
    | 'white'
    | 'two-or-more'
    | 'decline';
  veteran: '' | 'no' | 'yes' | 'decline';
  disability: '' | 'no' | 'yes' | 'decline';
}

export const NO_APPLICATIONS: ForApplications = {
  preferredName: '',
  pronouns: '',
  city: '',
  region: '',
  country: '',
  github: '',
  countries: [],
  sponsorship: '',
  over18: '',
  howHeard: '',
};

export const NO_EQUAL_OPPORTUNITY: EqualOpportunity = {
  gender: '',
  hispanic: '',
  race: '',
  veteran: '',
  disability: '',
};

export const NO_PRIVATE: KeptPrivate = {
  street: '',
  postalCode: '',
  equalOpportunity: NO_EQUAL_OPPORTUNITY,
};

/**
 * What a resume Factwright made for you says of you, for the fields Profile leaves blank: the
 * job's own resume, or your newest, when the job has none yet.
 */
export interface ResumeOnFile {
  /** Whose it is: the job's own, or your newest, made for another job or as a base. */
  from: 'job' | 'newest';
  name: string;
  email: string;
  phone: string;
  /** Where you live, as the resume says it, such as "Denver, CO". */
  location: string;
  linkedin: string;
  website: string;
  /** Where you work now, by the job that runs to the present, as what, and since when. */
  company: string;
  title: string;
  since: string;
  /** Every position the resume lists, newest first, with its company, and when, as it says. */
  positions: { company: string; title: string; location: string; start: string; end: string }[];
  /** Your schools, as the resume lists them, newest first. */
  education: { school: string; degree: string; start: string; end: string }[];
  /** Your skills, by their category. */
  skills: { category: string; items: string[] }[];
  /** Its other sections, such as Certifications, by their headings. */
  sections: { heading: string; items: string[] }[];
  summary: string;
}

/** An answer you sent before, with whose application it was in. */
export interface SentBefore {
  question: string;
  text: string;
  /** When, as an ISO date. */
  on: string;
  /** The company you sent it to. */
  company: string;
}

/** What Factwright has on file to answer a form with. */
export interface OnFile {
  you: {
    name: string;
    email: string;
    phone: string;
    /** Such as "Denver, CO". */
    location: string;
    linkedin: string;
    website: string;
  };
  applications: ForApplications;
  /** What's kept on this computer alone: your street, postal code and equal-opportunity answers. */
  kept: KeptPrivate;
  /** Profile's own words on working where the jobs are, such as "US citizen". */
  authorization: string;
  /** When you can start, as you put it, such as "two weeks' notice". */
  start: string;
  relocate: '' | 'no' | 'maybe' | 'yes';
  /** The pay you're after, as you put it, such as "$150,000". */
  targetPay: string;
  /** What the job's own resume, or your newest, says of you, or null when you have none yet. */
  resume: ResumeOnFile | null;
  /** Profile's work history and education, for forms that ask for each job and school. */
  history: WorkHistory;
  /**
   * The job the form is for: who it's with, where you found it, such as "LinkedIn", and where
   * it's based, as its posting says, such as "Denver, CO".
   */
  job: { company: string; foundOn: string; location: string } | null;
  /** What you sent before, newest first. */
  sent: readonly SentBefore[];
  /** Your Claude's drafts for this job's questions. */
  suggested: readonly SuggestedAnswer[];
  /** The job's files, by their names, or null when it has none of that kind. */
  files: { resume: string | null; coverLetter: string | null };
  /** The job's cover letter as plain text, for a box that takes one. */
  letterText: string | null;
  /** Today, as an ISO date, for saying when you sent an answer before. */
  today: string;
}

/** Where an answer came from. */
export type AnswerSource = 'profile' | 'resume' | 'job' | 'sent' | 'claude' | 'you';

/** Why a field is left for you. */
export type LeftFor =
  /** Factwright never fills it: a password, payment details, an ID number or a date of birth. */
  | 'never'
  /** Agreeing to something, which is yours to do. */
  | 'consent'
  /** A personal question, such as your age, which only you answer, each time. */
  | 'personal'
  /** Profile has nothing for it yet. */
  | 'unset'
  /**
   * An equal-opportunity question you haven't set an answer for, "Leave for me", or one to type
   * an answer in, which you answer yourself.
   */
  | 'sensitive'
  /** Nothing on file answers it: a question for you or your Claude. */
  | 'new'
  /**
   * What's on file answers it, but not as the field takes it: a date to pick on a calendar, the
   * end of a job you still hold, or a box to tick.
   */
  | 'pick';

/** Factwright's answer for a field: what to put in it and where that came from, or why it's yours. */
export interface FieldReply {
  kind: FieldKind;
  /** Text to type. */
  text?: string;
  /** For a choice: the options to pick, best first, by their words. */
  pick?: string[];
  /** Pick only an option with these words exactly, as for an answer given to another form. */
  exact?: boolean;
  /** One of the job's own files. */
  file?: 'resume' | 'cover-letter';
  source: AnswerSource;
  /** Where it came from, in a few words, such as "From your Acme application, Oct 12". */
  from?: string;
  /** Why it's left for you. */
  left?: LeftFor;
  /**
   * Other answers on file that fit as well, best first, such as what you sent another company to
   * the same question, or your Claude's draft for this job: the extension's menus in a form's
   * fields offer them beside this one. Filling a form puts in this one alone.
   */
  others?: OtherAnswer[];
}

/** Another answer on file for a field, as a menu in the field offers it. */
export type OtherAnswer = Pick<FieldReply, 'text' | 'pick' | 'exact' | 'source' | 'from'>;

/** The most other answers a field's reply carries. */
export const MOST_OTHERS = 3;

/** The words that mean "I'd rather not say", as forms put them. */
const DECLINE = [
  'I don’t wish to answer',
  'I do not wish to answer',
  'I do not want to answer',
  'I prefer not to answer',
  'Prefer not to answer',
  'Prefer not to say',
  'Prefer not to disclose',
  'I prefer not to say',
  'Decline to self identify',
  'Decline to answer',
  'Choose not to disclose',
  'I choose not to disclose',
  'Not specified',
  'Decline',
];

/** The options that mean each equal-opportunity answer, as forms put them. */
const EQUAL_OPPORTUNITY_PICKS: {
  [K in keyof EqualOpportunity]: Record<Exclude<EqualOpportunity[K], ''>, string[]>;
} = {
  gender: {
    woman: ['Woman', 'Female', 'Women'],
    man: ['Man', 'Male', 'Men'],
    'non-binary': ['Non-binary', 'Nonbinary', 'Non binary', 'Genderqueer or non-binary'],
    decline: DECLINE,
  },
  hispanic: {
    yes: ['Yes', 'Hispanic or Latino', 'Hispanic/Latino', 'Yes, I am Hispanic or Latino'],
    no: ['No', 'Not Hispanic or Latino', 'No, I am not Hispanic or Latino'],
    decline: DECLINE,
  },
  race: {
    'american-indian': [
      'American Indian or Alaska Native',
      'American Indian or Alaskan Native',
      'Native American or Alaska Native',
      'Native American',
    ],
    asian: ['Asian'],
    black: ['Black or African American', 'Black'],
    hispanic: ['Hispanic or Latino', 'Hispanic/Latino', 'Hispanic'],
    'pacific-islander': [
      'Native Hawaiian or Other Pacific Islander',
      'Native Hawaiian or Pacific Islander',
      'Pacific Islander',
    ],
    white: ['White', 'White (Not Hispanic or Latino)', 'Caucasian'],
    'two-or-more': [
      'Two or More Races',
      'Two or more races (Not Hispanic or Latino)',
      'Multiracial',
    ],
    decline: DECLINE,
  },
  veteran: {
    no: ['I am not a protected veteran', 'I am not a veteran', 'Not a protected veteran', 'No'],
    yes: [
      'I identify as one or more of the classifications of protected veteran',
      'I am a protected veteran',
      'I am a veteran',
      'Yes',
    ],
    decline: DECLINE,
  },
  disability: {
    no: [
      'No, I do not have a disability and have not had one in the past',
      'No, I don’t have a disability',
      'No, I do not have a disability',
      'No',
    ],
    yes: [
      'Yes, I have a disability (or previously had a disability)',
      'Yes, I have a disability',
      'Yes',
    ],
    decline: DECLINE,
  },
};

/** Words, compared: lowercase, letters and digits. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The country where you live says, such as "United States" for "Denver, CO", or "". */
function livesIn(location: string | undefined): string {
  const [code] = countriesOfPlace(location ?? '');
  return code ? countryName(code) : '';
}

/** A degree's level, as a choice of degrees names it: "B.S., Computer Science" is a Bachelor's. */
function degreeNames(degree: string): string[] {
  const said = plain(degree);
  const levels: [RegExp, string[]][] = [
    [/\b(ph ?d|doctor(ate)?|d phil|ed ?d)\b/, ['Doctorate', 'Doctoral Degree', 'Ph.D.', 'PhD']],
    [
      /\b(m ?b ?a|master|masters|m ?s|m ?sc|m ?a|m ?eng|m ?ed|m ?fa|m ?p ?h)\b/,
      ["Master's Degree", "Master's", 'Master', 'MBA', 'MS', 'MA'],
    ],
    [
      /\b(bachelor|bachelors|b ?s|b ?sc|b ?a|b ?eng|b ?b ?a|b ?f ?a|a ?b)\b/,
      ["Bachelor's Degree", "Bachelor's", 'Bachelor', 'BS', 'BA'],
    ],
    [/\b(associate|associates|a ?a|a ?s)\b/, ["Associate's Degree", "Associate's", 'Associate']],
    [/\b(high school|ged|secondary)\b/, ['High School', 'High School Diploma', 'GED']],
  ];
  const level = levels.find(([words]) => words.test(said))?.[1] ?? [];
  return [...level, degree].filter(Boolean);
}

/** A degree's field of study: "Computer Science" in "B.S., Computer Science" or "BA in History". */
function fieldOfStudy(degree: string): string {
  const comma = degree.indexOf(',');
  if (comma >= 0) return degree.slice(comma + 1).trim();
  const at = degree.toLowerCase().lastIndexOf(' in ');
  return at >= 0 ? degree.slice(at + 4).trim() : '';
}

/** Where an answer came from: Profile's work history, or a resume. */
interface Said {
  source: AnswerSource;
  from: string;
}

/** A position, as a form asks for it, with where it came from. */
type HeldAt = HeldPosition & Said;

/**
 * The position a form asks for, the nth time it asks, newest first: from Profile's work history,
 * or else the resume, as it lists them.
 */
function positionAt(onFile: OnFile, nth: number): HeldAt | null {
  const fromHistory = positionsOf(onFile.history)[nth];
  if (fromHistory) return { ...fromHistory, source: 'profile', from: 'From your work history' };
  const resume = onFile.resume;
  const listed = resume?.positions[nth];
  if (!resume || !listed) return null;
  return {
    ...listed,
    start: datedAs(listed.start),
    end: datedAs(listed.end),
    summary: '',
    source: 'resume',
    from: fromResume(resume),
  };
}

/** The position you hold now, from Profile's work history, or else the resume. */
function currentPosition(onFile: OnFile): HeldAt | null {
  const now = positionsOf(onFile.history).find((each) => each.end === 'present');
  if (now) return { ...now, source: 'profile', from: 'From your work history' };
  const resume = onFile.resume;
  if (!resume?.company && !resume?.title) return null;
  return {
    company: resume.company,
    title: resume.title,
    location: '',
    start: datedAs(resume.since),
    end: 'present',
    summary: '',
    source: 'resume',
    from: fromResume(resume),
  };
}

/** The school a form asks for, the nth time it asks: from Profile, or else the resume. */
function schoolAt(onFile: OnFile, nth: number): (School & Said) | null {
  const fromHistory = onFile.history.schools[nth];
  if (fromHistory) return { ...fromHistory, source: 'profile', from: 'From your work history' };
  const resume = onFile.resume;
  const listed = resume?.education[nth];
  if (!resume || !listed) return null;
  return {
    school: listed.school,
    degree: listed.degree,
    field: fieldOfStudy(listed.degree),
    start: datedAs(listed.start),
    end: datedAs(listed.end),
    source: 'resume',
    from: fromResume(resume),
  };
}

/**
 * How many jobs and schools on file a form that asks for each one can take, one to a part:
 * Profile's work history, then the resume's, past what the history lists, as each part takes the
 * next. The extension adds a part for each on a form with a button that adds another, as
 * Workday's My Experience has, when you choose to.
 */
export function blocksOnFile(onFile: OnFile): { jobs: number; schools: number } {
  return {
    jobs: Math.max(positionsOf(onFile.history).length, onFile.resume?.positions.length ?? 0),
    schools: Math.max(onFile.history.schools.length, onFile.resume?.education.length ?? 0),
  };
}

/** The months, by the words a resume may use for them. */
const MONTH_WORDS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/**
 * A date as a resume words it, such as "Mar 2021", "03/2021", "2021" or "Present", as the work
 * history keeps it: "2021-03", "2021" or "present", or "" for one it can't read.
 */
export function datedAs(text: string): string {
  const said = text.trim().toLowerCase();
  if (/^(present|current|now|today)$/.test(said)) return 'present';
  const year = /\b(19|20)\d{2}\b/.exec(said)?.[0];
  if (!year) return '';
  const numbered = /^(\d{1,2})[/.-](19|20)\d{2}$/.exec(said)?.[1];
  const named = MONTH_WORDS.findIndex((month) => said.startsWith(month));
  const month = numbered ? Number(numbered) : named >= 0 ? named + 1 : 0;
  return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : year;
}

/**
 * A start or an end, as the field takes it: a month or a year where a form asks for one alone, a
 * month a month box takes, or the date as typed, "03/2021". One that's still going is "Present"
 * to type or pick, and where a form asks for its month or year, yours, as its own box says so.
 */
function dateReply(kind: FieldKind, field: FormField, date: string, said: Said): FieldReply {
  if (!date) return left(kind, 'unset');
  const question = plain(`${field.question} ${field.hint}`);
  const month = /\bmonth\b/.test(question);
  const year = /\byear\b/.test(question);
  const reply = (words: string[]): FieldReply =>
    words.some(Boolean) ? { ...fromProfile(kind, field, ...words), ...said } : left(kind, 'unset');
  if (date === 'present') {
    return month || year || field.control === 'date'
      ? left(kind, 'pick')
      : reply(['Present', 'Current']);
  }
  if (month) {
    const names = monthNames(date);
    return choosing(field)
      ? reply(names)
      : reply([field.control === 'number' ? (names[2] ?? '') : (names[0] ?? '')]);
  }
  if (year) return reply([yearOf(date)]);
  // A calendar wants a day, which a job's dates never say.
  if (field.control === 'date') return left(kind, 'pick');
  if (field.type === 'month')
    return /^\d{4}-\d{2}$/.test(date) ? reply([date]) : left(kind, 'pick');
  return reply([typedDate(date), yearOf(date)]);
}

/**
 * Factwright's answers for a form's fields, in order: each part of the form for a job or a
 * school takes the next one, newest first, as a form asks for one job, then another.
 */
export function answerForm(fields: readonly FormField[], onFile: OnFile): FieldReply[] {
  const asked = new Map<string, number>();
  const replies = fields.map((field) => {
    const part = fieldPart(field);
    if (!part) return answerField(field, onFile);
    const kind = fieldKind(field);
    // A date's month and its year are two fields of one job, each asked once a job.
    const question = plain(field.question);
    const piece = /\bmonth\b/.test(question) ? 'month' : /\byear\b/.test(question) ? 'year' : '';
    const key = `${part}:${kind}:${piece}`;
    const nth = asked.get(key) ?? 0;
    asked.set(key, nth + 1);
    return answerField(field, onFile, nth);
  });
  return withinOthers(replies);
}

/**
 * The most a form's other answers carry, all told, in characters, so the app's answer for a long
 * form stays well within what the extension's helper takes.
 */
const MOST_OTHER_WORDS = 100_000;

/** A form's replies, without the other answers of the fields that carry most, past the most. */
function withinOthers(replies: FieldReply[]): FieldReply[] {
  const size = (reply: FieldReply) =>
    (reply.others ?? []).reduce(
      (sum, other) => sum + (other.text?.length ?? 0) + (other.pick?.join('').length ?? 0),
      0,
    );
  let total = replies.reduce((sum, reply) => sum + size(reply), 0);
  if (total <= MOST_OTHER_WORDS) return replies;
  const kept = [...replies];
  const largest = replies
    .map((reply, at) => ({ at, size: size(reply) }))
    .filter((each) => each.size > 0)
    .sort((a, b) => b.size - a.size);
  for (const { at, size: dropped } of largest) {
    if (total <= MOST_OTHER_WORDS) break;
    const { others: _, ...reply } = kept[at] as FieldReply;
    kept[at] = reply;
    total -= dropped;
  }
  return kept;
}

/** An answer that fits the field's limit, or left for you when it doesn't. */
function withinLimit(kind: FieldKind, field: FormField, reply: FieldReply): FieldReply {
  return reply.text && field.limit && reply.text.length > field.limit ? left(kind, 'unset') : reply;
}

/** A state's other name: "CO" for "Colorado", and "Colorado" for "CO". */
function regionNames(region: string): string[] {
  const code = region.trim().toUpperCase();
  if (US_STATES[code]) return [region, US_STATES[code]];
  const found = Object.entries(US_STATES).find(([, name]) => plain(name) === plain(region));
  return found ? [region, found[0]] : [region];
}

/** "Denver, CO" as a city and a region. */
function placeParts(location: string): { city: string; region: string } {
  const [city = '', region = ''] = location.split(',').map((part) => part.trim());
  return { city, region: /^(remote|anywhere)$/i.test(region) ? '' : region };
}

/** The first and last of a name: "Ana María Ruiz" is "Ana María" and "Ruiz". */
function nameParts(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] ?? '', last: '' };
  return { first: words.slice(0, -1).join(' '), last: words.at(-1) ?? '' };
}

/** Whether a field takes its answer as one of its options. */
const choosing = (field: FormField) =>
  field.control === 'choice' || field.control === 'choices' || field.control === 'combo';

const left = (kind: FieldKind, why: LeftFor): FieldReply => ({ kind, source: 'you', left: why });

/** An answer from Profile: text for a box, or the same words to pick among a choice's options. */
function fromProfile(kind: FieldKind, field: FormField, ...words: string[]): FieldReply {
  const [first = ''] = words.filter(Boolean);
  if (!first) return left(kind, 'unset');
  if (choosing(field)) return { kind, pick: words.filter(Boolean), source: 'profile' };
  return { kind, text: first, source: 'profile' };
}

/** Where an answer from a resume came from, in words. */
const fromResume = (resume: ResumeOnFile) =>
  resume.from === 'job' ? 'From the job’s resume' : 'From your newest resume';

/**
 * Profile's answer, or else the resume's, for a field Profile leaves blank, saying which resume
 * it came from.
 */
function profileOrResume(
  kind: FieldKind,
  field: FormField,
  profile: readonly string[],
  resume: readonly string[],
  onFile: OnFile,
): FieldReply {
  if (profile.some(Boolean)) return fromProfile(kind, field, ...profile);
  if (!onFile.resume || !resume.some(Boolean)) return left(kind, 'unset');
  return {
    ...fromProfile(kind, field, ...resume),
    source: 'resume',
    from: fromResume(onFile.resume),
  };
}

/** An answer only a resume gives, saying which. */
function resumeSays(kind: FieldKind, field: FormField, onFile: OnFile, ...words: string[]) {
  return profileOrResume(kind, field, [], words, onFile);
}

/** Yes or no, as a choice's option, or as text. */
function yesNo(
  kind: FieldKind,
  field: FormField,
  yes: boolean | null,
  source: AnswerSource = 'profile',
): FieldReply {
  if (yes === null) return left(kind, 'unset');
  const word = yes ? 'Yes' : 'No';
  if (choosing(field) || field.control === 'check') {
    return field.control === 'check' ? left(kind, 'unset') : { kind, pick: [word], source };
  }
  return { kind, text: word, source };
}

/** Whether you'll need sponsorship, as the question asks it: now, or now or later. */
function needsSponsorship(
  field: FormField,
  sponsorship: ForApplications['sponsorship'],
): boolean | null {
  if (!sponsorship) return null;
  const said = plain(`${field.question} ${field.hint}`);
  const later = /\b(future|later|will you|ever|at any time|eventually)\b/.test(said);
  return sponsorship === 'now' || (later && sponsorship === 'later');
}

/**
 * Whether you can work where a question asks: yes, when Profile lists every country it names,
 * and otherwise it's for you, as you may be able to with a visa. A question that names none, such
 * as "in the country you applied for", asks about where the job is, when its location says. One
 * that names a region, such as "the EU", is for you too.
 */
function authorizedFor(field: FormField, onFile: OnFile): boolean | null {
  const listed = new Set(onFile.applications.countries.map(countryCode).filter(Boolean));
  if (listed.size === 0) return null;
  const named = placesIn(`${field.question} ${field.hint}`);
  if (named.region) return null;
  const where =
    named.countries.length > 0 ? named.countries : countriesOfPlace(onFile.job?.location ?? '');
  return where.length > 0 && where.every((code) => listed.has(code)) ? true : null;
}

/** "How did you hear about us?": where you found the job, or Profile's default. */
function heardFrom(field: FormField, onFile: OnFile): FieldReply {
  const found = onFile.job?.foundOn ?? '';
  const fallback = onFile.applications.howHeard;
  const picks = [
    found,
    ...(found === 'Company website'
      ? ['Company Website', 'Careers page', 'Career site', 'Website']
      : []),
    ...(found === 'LinkedIn' ? ['LinkedIn', 'Linkedin'] : []),
    fallback,
  ].filter(Boolean);
  if (picks.length === 0) return left('how-heard', 'unset');
  if (choosing(field)) return { kind: 'how-heard', pick: picks, source: found ? 'job' : 'profile' };
  return { kind: 'how-heard', text: picks[0], source: found ? 'job' : 'profile' };
}

/** Whether a question names a company, as "Why do you want to work at Acme?" does. */
function namesCompany(question: string, companies: readonly string[]): boolean {
  const said = ` ${plain(question)} `;
  return companies.some((company) => {
    const name = plain(company);
    return name.length >= 2 && said.includes(` ${name} `);
  });
}

/**
 * Whether an answer you wrote for one company's form is about that company, so it fits only its
 * own: one to "Why do you want to work at Lumen Health?", or one that says "…bring my background
 * to Lumen Health", whatever it was asked.
 */
function aboutCompany(each: SentBefore, company: string): boolean {
  if (namesCompany(each.question, [each.company, company])) return true;
  return plain(each.company) !== plain(company) && namesCompany(each.text, [each.company]);
}

/** A question of the form's own: what you sent before, then your Claude's draft for the job. */
function ownQuestion(field: FormField, onFile: OnFile): FieldReply {
  const key = questionKey(field.question);
  if (!key) return left('question', 'new');
  const job = onFile.job?.company ?? '';
  const written = field.control === 'long' || field.control === 'text';
  const fits = (text: string) => !field.limit || text.length <= field.limit;
  // Each answer you sent to the same question, newest first.
  const sent = onFile.sent.filter(
    (each) =>
      questionKey(each.question) === key &&
      each.text.trim() &&
      !(written && aboutCompany(each, job)),
  );
  /** An answer you sent, as this field takes it, or null when it's longer than the field takes. */
  const fromSent = (before: SentBefore): FieldReply | null => {
    const from = `From your ${before.company || 'earlier'} application, ${shortDate(before.on, onFile.today)}`;
    if (choosing(field)) {
      return { kind: 'question', pick: [before.text], exact: true, source: 'sent', from };
    }
    return fits(before.text) ? { kind: 'question', text: before.text, source: 'sent', from } : null;
  };
  const drafts = onFile.suggested.filter((each) => questionKey(each.question) === key);
  const draft = drafts.at(-1);
  // A draft that says only you can answer it, and why, leaves it for you, saying why.
  const forYou = draft !== undefined && /^\s*for you:/i.test(draft.answer);
  const drafted = ((): FieldReply | null => {
    if (forYou || !draft?.answer.trim()) return null;
    const from = 'Your Claude’s draft for this job';
    // A question that takes any of its options takes each the draft picks, as "SQL; Python".
    const picks =
      field.control === 'choices'
        ? draft.answer
            .split(/[;\n]/)
            .map((each) => each.trim().replace(/^[-*]\s+/, ''))
            .filter(Boolean)
        : [draft.answer.trim()];
    if (choosing(field))
      return { kind: 'question', pick: picks, exact: true, source: 'claude', from };
    return fits(draft.answer)
      ? { kind: 'question', text: draft.answer, source: 'claude', from }
      : null;
  })();
  // The answer: the newest you sent, where it fits, or else your Claude's draft.
  const newest = sent[0] ? fromSent(sent[0]) : null;
  if (!newest && draft && forYou) return { ...left('question', 'new'), from: draft.answer.trim() };
  const first = newest ?? drafted;
  if (!first) return left('question', 'new');
  // Beside it, for the field menus, the others on file that fit too: what you sent before that,
  // then your Claude's draft. The same words twice are one.
  const words = (reply: FieldReply) => plain(reply.text ?? reply.pick?.join(' ') ?? '');
  const said = new Set([words(first)]);
  const others = [...sent.slice(1).map(fromSent), first === drafted ? null : drafted]
    .filter((each): each is FieldReply => each !== null)
    .filter((each) => {
      const these = words(each);
      if (said.has(these)) return false;
      said.add(these);
      return true;
    })
    .slice(0, MOST_OTHERS);
  if (others.length === 0) return first;
  return { ...first, others: others.map(({ kind: _, ...other }) => other) };
}

/**
 * A link, from Profile or else the resume, or only its last part where a form asks for a user
 * name.
 */
function linkOrHandle(
  kind: FieldKind,
  field: FormField,
  mine: string,
  resume: ResumeOnFile | null = null,
  theirs = '',
): FieldReply {
  const link = mine || theirs;
  if (!link) return left(kind, 'unset');
  const said = (text: string): FieldReply =>
    mine || !resume
      ? { kind, text, source: 'profile' }
      : { kind, text, source: 'resume', from: fromResume(resume) };
  if (/\b(user ?name|handle)\b/.test(plain(`${field.question} ${field.hint}`))) {
    // "https://github.com/you/" is "you": the last part of its path.
    const handle =
      (link.split(/[?#]/)[0] ?? '')
        .split('/')
        .filter((part) => part !== '')
        .at(-1) ?? '';
    return handle ? said(handle) : left(kind, 'unset');
  }
  return said(link);
}

/** Pay as one amount a year, for a box that takes a number, or null when it isn't one, clearly. */
function yearlyPay(field: FormField, targetPay: string): number | null {
  // By the hour, week or month, or in thousands, a number says something else.
  const other = /\b(hour|hourly|hr|week|weekly|month|monthly|day|daily|thousands?|in k)\b/;
  if (other.test(plain(`${field.question} ${field.hint} ${targetPay}`))) return null;
  const pay = parsePay(targetPay);
  return pay && pay.min === pay.max ? pay.min : null;
}

/**
 * Factwright's answer for one field, from what's on file, or why it's left for you. It never
 * answers a password, payment details, an ID number, a date of birth or a personal question,
 * never agrees to anything for you, and answers an equal-opportunity question only as you set it
 * in Profile, and only by picking one of its options.
 */
export function answerField(field: FormField, onFile: OnFile, nth = 0): FieldReply {
  const kind = fieldKind(field);
  const { you, applications } = onFile;
  const place = placeParts(you.location);
  const name = nameParts(you.name);
  if (kind === 'never' || kind === 'personal') return left(kind, kind);
  if (kind === 'consent' || (field.control === 'check' && kind === 'question')) {
    return left(kind, kind === 'consent' ? 'consent' : 'new');
  }
  if (isEqualOpportunity(kind)) {
    const answer = onFile.kept.equalOpportunity[kind];
    // Only a choice among a form's options takes Profile's answer: a box to type in is for your
    // own words.
    if (!answer || !choosing(field)) return left(kind, 'sensitive');
    const picks = (EQUAL_OPPORTUNITY_PICKS[kind] as Record<string, string[]>)[answer] ?? [];
    return { kind, pick: picks, source: 'profile' };
  }
  // Factwright never ticks a box of its own: one that says what Profile knows, as Workday's "I
  // have a preferred name", is yours to tick.
  if (field.control === 'check') return left(kind, 'pick');
  const resume = onFile.resume;
  const theirs = nameParts(resume?.name ?? '');
  const theirPlace = placeParts(resume?.location ?? '');
  switch (kind) {
    case 'first-name':
      return profileOrResume(kind, field, [name.first], [theirs.first], onFile);
    case 'last-name':
      return profileOrResume(kind, field, [name.last], [theirs.last], onFile);
    case 'full-name':
      return profileOrResume(kind, field, [you.name], [resume?.name ?? ''], onFile);
    case 'preferred-name':
      return fromProfile(kind, field, applications.preferredName);
    case 'pronouns':
      return fromProfile(kind, field, applications.pronouns);
    case 'email':
      return profileOrResume(kind, field, [you.email], [resume?.email ?? ''], onFile);
    case 'phone':
      return profileOrResume(kind, field, [you.phone], [resume?.phone ?? ''], onFile);
    case 'phone-country': {
      const mine = applications.country || livesIn(you.location);
      return choosing(field)
        ? profileOrResume(
            kind,
            field,
            mine ? countryNames(mine) : [],
            countryNames(livesIn(resume?.location)).filter(Boolean),
            onFile,
          )
        : left(kind, 'unset');
    }
    case 'street':
      return fromProfile(kind, field, onFile.kept.street);
    case 'city':
      return profileOrResume(
        kind,
        field,
        [applications.city || place.city],
        [theirPlace.city],
        onFile,
      );
    case 'region': {
      const mine = applications.region || place.region;
      return profileOrResume(
        kind,
        field,
        mine ? regionNames(mine) : [],
        theirPlace.region ? regionNames(theirPlace.region) : [],
        onFile,
      );
    }
    case 'postal-code':
      return fromProfile(kind, field, onFile.kept.postalCode);
    case 'country': {
      // Where you live says your country, when For applications doesn't.
      const mine = applications.country || livesIn(you.location);
      const fromResumes = livesIn(resume?.location);
      return profileOrResume(
        kind,
        field,
        mine ? countryNames(mine) : [],
        fromResumes ? countryNames(fromResumes) : [],
        onFile,
      );
    }
    case 'location': {
      // A choice of places can be cities or countries, as some forms ask "your location" with a
      // list of countries: your city first, then your country, by its names.
      const country = applications.country || livesIn(you.location || resume?.location);
      if (choosing(field)) {
        const names = country ? countryNames(country) : [];
        return profileOrResume(
          kind,
          field,
          you.location ? [you.location, place.city, ...names] : [],
          resume?.location ? [resume.location, theirPlace.city, ...names] : names,
          onFile,
        );
      }
      return profileOrResume(kind, field, [you.location], [resume?.location ?? ''], onFile);
    }
    case 'linkedin':
      return linkOrHandle(kind, field, you.linkedin, resume, resume?.linkedin);
    case 'github':
      return linkOrHandle(kind, field, applications.github);
    case 'website':
      return linkOrHandle(kind, field, you.website, resume, resume?.website);
    case 'current-company':
    case 'current-title':
    case 'job-start':
    case 'job-end':
    case 'job-location':
    case 'job-summary': {
      // In a part of the form for each job, the job it's asking for; asked once, the one you
      // hold now.
      const held = fieldPart(field) === 'job' ? positionAt(onFile, nth) : currentPosition(onFile);
      if (!held) return left(kind, 'unset');
      const said = { source: held.source, from: held.from };
      if (kind === 'job-start' || kind === 'job-end') {
        return dateReply(kind, field, kind === 'job-start' ? held.start : held.end, said);
      }
      const words =
        kind === 'current-company'
          ? held.company
          : kind === 'current-title'
            ? held.title
            : kind === 'job-location'
              ? held.location
              : held.summary;
      if (!words) return left(kind, 'unset');
      return withinLimit(kind, field, { ...fromProfile(kind, field, words), ...said });
    }
    case 'school':
    case 'degree':
    case 'discipline':
    case 'graduation':
    case 'edu-start': {
      const studied = schoolAt(onFile, nth);
      if (!studied) return left(kind, 'unset');
      const said = { source: studied.source, from: studied.from };
      if (kind === 'edu-start' || kind === 'graduation') {
        const date = kind === 'edu-start' ? studied.start : studied.end;
        // A school's end, asked as a year to type, as a resume gives it.
        return dateReply(kind, field, date, said);
      }
      const words =
        kind === 'school'
          ? [studied.school]
          : kind === 'discipline'
            ? [studied.field]
            : choosing(field)
              ? degreeNames(studied.degree)
              : [studied.degree];
      if (!words.some(Boolean)) return left(kind, 'unset');
      return { ...fromProfile(kind, field, ...words), ...said };
    }
    case 'skills': {
      const items = resume?.skills.flatMap((each) => each.items) ?? [];
      if (choosing(field)) {
        return items.length > 0 && onFile.resume
          ? {
              kind,
              pick: items,
              exact: true,
              source: 'resume',
              from: fromResume(onFile.resume),
            }
          : left(kind, 'unset');
      }
      const text =
        field.control === 'long'
          ? (resume?.skills ?? [])
              .map((each) => `${each.category}: ${each.items.join(', ')}`)
              .join('\n')
          : items.join(', ');
      return withinLimit(kind, field, resumeSays(kind, field, onFile, text));
    }
    case 'certifications': {
      const items =
        resume?.sections
          .filter((each) => /certif|licen/i.test(each.heading))
          .flatMap((each) => each.items) ?? [];
      return choosing(field)
        ? left(kind, 'unset')
        : withinLimit(
            kind,
            field,
            resumeSays(kind, field, onFile, items.join(field.control === 'long' ? '\n' : '; ')),
          );
    }
    case 'summary':
      return field.control === 'long'
        ? withinLimit(kind, field, resumeSays(kind, field, onFile, resume?.summary ?? ''))
        : left(kind, 'unset');
    case 'middle-name':
    case 'street-2':
    case 'gpa':
      return left(kind, 'unset');
    // Factwright never ticks a box: whether you work there now is yours to tick.
    case 'job-current':
      return left(kind, 'pick');
    // Nothing on file says where a school is, or whose a date is with nothing saying.
    case 'edu-location':
    case 'block-date':
      return left(kind, 'new');
    case 'authorized': {
      const can = authorizedFor(field, onFile);
      if (!/\bsponsor/.test(plain(field.question))) return yesNo(kind, field, can);
      // "Are you authorized to work here without sponsorship?" asks both.
      const needs = needsSponsorship(field, applications.sponsorship);
      return yesNo(kind, field, can === null || needs === null ? null : can && !needs);
    }
    case 'sponsorship': {
      const needs = needsSponsorship(field, applications.sponsorship);
      // "Can you work here without sponsorship?" asks the other way round.
      const without = WITHOUT_SPONSORSHIP.test(plain(field.question));
      return yesNo(kind, field, needs === null ? null : without ? !needs : needs);
    }
    case 'relocation':
      if (onFile.relocate === 'yes' || onFile.relocate === 'no') {
        return yesNo(kind, field, onFile.relocate === 'yes');
      }
      return left(kind, 'unset');
    case 'over-18':
      return yesNo(kind, field, applications.over18 ? applications.over18 === 'yes' : null);
    case 'start-date':
      return field.control === 'date' || choosing(field)
        ? left(kind, 'unset')
        : fromProfile(kind, field, onFile.start);
    case 'how-heard':
      return heardFrom(field, onFile);
    case 'pay': {
      if (!onFile.targetPay || choosing(field)) return left(kind, 'unset');
      if (field.control !== 'number') return { kind, text: onFile.targetPay, source: 'profile' };
      const yearly = yearlyPay(field, onFile.targetPay);
      return yearly ? { kind, text: String(yearly), source: 'profile' } : left(kind, 'unset');
    }
    case 'resume':
      return onFile.files.resume
        ? { kind, file: 'resume', source: 'job', from: onFile.files.resume }
        : left(kind, 'unset');
    case 'cover-letter':
      return onFile.files.coverLetter
        ? { kind, file: 'cover-letter', source: 'job', from: onFile.files.coverLetter }
        : left(kind, 'unset');
    case 'cover-letter-text':
      return onFile.letterText && (!field.limit || onFile.letterText.length <= field.limit)
        ? { kind, text: onFile.letterText, source: 'job', from: 'The job’s cover letter' }
        : left(kind, 'unset');
    default:
      return field.control === 'file' ? left(kind, 'new') : ownQuestion(field, onFile);
  }
}

/**
 * The kinds of field whose answer, typed on a form when Factwright had none, it offers to keep in
 * Profile for next time. Names stay as Profile has them, and a form's own questions are kept as
 * what you sent.
 */
export const REMEMBERED_KINDS = [
  'preferred-name',
  'pronouns',
  'email',
  'phone',
  'street',
  'city',
  'region',
  'postal-code',
  'country',
  'location',
  'linkedin',
  'github',
  'website',
  'start-date',
  'how-heard',
  'gender',
  'hispanic',
  'race',
  'veteran',
  'disability',
] as const satisfies readonly FieldKind[];

export type RememberedKind = (typeof REMEMBERED_KINDS)[number];

/** Whether Factwright offers to keep a kind of field's answer in Profile. */
export const isRemembered = (kind: FieldKind): kind is RememberedKind =>
  (REMEMBERED_KINDS as readonly FieldKind[]).includes(kind);

/**
 * An equal-opportunity answer as Profile keeps it, from an option a form showed, such as "Female"
 * for "woman", or null when the option isn't one Profile knows.
 */
export function readEqualOpportunity<K extends keyof EqualOpportunity>(
  kind: K,
  option: string,
): Exclude<EqualOpportunity[K], ''> | null {
  const said = plain(option);
  if (!said) return null;
  const answers = EQUAL_OPPORTUNITY_PICKS[kind] as Record<string, string[]>;
  for (const [answer, picks] of Object.entries(answers)) {
    if (picks.some((pick) => plain(pick) === said))
      return answer as Exclude<EqualOpportunity[K], ''>;
  }
  for (const [answer, picks] of Object.entries(answers)) {
    if (picks.some((pick) => said.startsWith(`${plain(pick)} `))) {
      return answer as Exclude<EqualOpportunity[K], ''>;
    }
  }
  return null;
}
