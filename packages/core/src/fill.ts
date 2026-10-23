import { questionKey, type SuggestedAnswer } from './answers.ts';
import { shortDate } from './format.ts';
import { type FieldKind, type FormField, fieldKind, isEqualOpportunity } from './forms.ts';

/**
 * Answering an application form from what's on file, field by field: Profile first, then the
 * job's own resume and letter, then what you sent before, then your Claude's drafts for the job.
 * Anything else is left for you. Equal-opportunity questions are answered only from what you set
 * in Profile, and passwords, payment details, ID numbers and dates of birth never.
 */

/** Profile's part for applications: what forms ask that a resume doesn't say. */
export interface ForApplications {
  /** The first name you go by, if it isn't the one on your resume. */
  preferredName: string;
  /** Such as "she/her". */
  pronouns: string;
  street: string;
  city: string;
  /** Your state, province or region, such as "CO" or "Colorado". */
  region: string;
  postalCode: string;
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
  street: '',
  city: '',
  region: '',
  postalCode: '',
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
  equalOpportunity: EqualOpportunity;
  /** Profile's own words on working where the jobs are, such as "US citizen". */
  authorization: string;
  /** When you can start, as you put it, such as "two weeks' notice". */
  start: string;
  relocate: '' | 'no' | 'maybe' | 'yes';
  /** The pay you're after, as you put it, such as "$150,000". */
  targetPay: string;
  /** Where the job's own resume says you work now. */
  resume: { company: string; title: string } | null;
  /** The job the form is for: who it's with, and where you found it, such as "LinkedIn". */
  job: { company: string; foundOn: string } | null;
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
  /** Profile has nothing for it yet. */
  | 'unset'
  /** An equal-opportunity question you haven't set an answer for: "Leave for me". */
  | 'sensitive'
  /** Nothing on file answers it: a question for you or your Claude. */
  | 'new';

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
}

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

/** Other names forms give a country, so "United States" picks "United States of America". */
const COUNTRY_NAMES: string[][] = [
  ['United States', 'United States of America', 'USA', 'US', 'U.S.'],
  ['United Kingdom', 'UK', 'Great Britain', 'United Kingdom of Great Britain and Northern Ireland'],
  ['Canada', 'CA'],
  ['Germany', 'Deutschland', 'DE'],
  ['Netherlands', 'The Netherlands', 'NL'],
  ['Ireland', 'Republic of Ireland', 'IE'],
  ['Australia', 'AU'],
  ['India', 'IN'],
];

/** US states by their two letters, so "CO" picks "Colorado", and "Colorado" picks "CO". */
const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
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

/** A country's names forms use, its own first. */
function countryNames(country: string): string[] {
  const known = COUNTRY_NAMES.find((names) => names.some((name) => plain(name) === plain(country)));
  return known ? [country, ...known.filter((name) => plain(name) !== plain(country))] : [country];
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
  const needs = sponsorship === 'now' || (later && sponsorship === 'later');
  // "Can you work without sponsorship?" asks the other way round.
  return /\bwithout\b/.test(said) ? !needs : needs;
}

/**
 * Whether you can work where a question asks: in the countries Profile lists. A question that
 * names no country, such as "in the country you applied for", takes your first.
 */
function authorizedFor(field: FormField, countries: readonly string[]): boolean | null {
  if (countries.length === 0) return null;
  const said = plain(`${field.question} ${field.hint}`);
  const named = COUNTRY_NAMES.flat().filter(
    (name) => name.length > 3 && new RegExp(`\\b${plain(name)}\\b`).test(said),
  );
  if (named.length === 0) return true;
  return countries.some((country) =>
    countryNames(country).some((name) => named.some((each) => plain(each) === plain(name))),
  );
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

/** A question of the form's own: what you sent before, then your Claude's draft for the job. */
function ownQuestion(field: FormField, onFile: OnFile): FieldReply {
  const key = questionKey(field.question);
  if (!key) return left('question', 'new');
  const job = onFile.job?.company ?? '';
  const written = field.control === 'long' || field.control === 'text';
  const before = onFile.sent.find(
    (each) =>
      questionKey(each.question) === key &&
      each.text.trim() &&
      // A written answer that's about a company fits only that company's form.
      !(written && namesCompany(each.question, [each.company, job])),
  );
  if (before) {
    const from = `From your ${before.company || 'earlier'} application, ${shortDate(before.on, onFile.today)}`;
    if (choosing(field)) {
      return { kind: 'question', pick: [before.text], exact: true, source: 'sent', from };
    }
    if (!field.limit || before.text.length <= field.limit) {
      return { kind: 'question', text: before.text, source: 'sent', from };
    }
  }
  const drafts = onFile.suggested.filter((each) => questionKey(each.question) === key);
  const draft = drafts.at(-1);
  if (draft?.answer.trim()) {
    const from = 'Your Claude’s draft for this job';
    if (choosing(field))
      return { kind: 'question', pick: [draft.answer], exact: true, source: 'claude', from };
    if (!field.limit || draft.answer.length <= field.limit) {
      return { kind: 'question', text: draft.answer, source: 'claude', from };
    }
  }
  return left('question', 'new');
}

/** A link, or only its last part where a form asks for a user name. */
function linkOrHandle(kind: FieldKind, field: FormField, link: string): FieldReply {
  if (!link) return left(kind, 'unset');
  if (/\b(user ?name|handle)\b/.test(plain(`${field.question} ${field.hint}`))) {
    // "https://github.com/you/" is "you".
    const handle = (link.split(/[?#]/)[0] ?? '').replace(/\/+$/, '').split('/').at(-1) ?? '';
    return handle ? { kind, text: handle, source: 'profile' } : left(kind, 'unset');
  }
  return { kind, text: link, source: 'profile' };
}

/**
 * Factwright's answer for one field, from what's on file, or why it's left for you. It never
 * answers a password, payment details, an ID number or a date of birth, never agrees to anything
 * for you, and answers an equal-opportunity question only as you set it in Profile.
 */
export function answerField(field: FormField, onFile: OnFile): FieldReply {
  const kind = fieldKind(field);
  const { you, applications } = onFile;
  const place = placeParts(you.location);
  const name = nameParts(you.name);
  if (kind === 'never') return left(kind, 'never');
  if (kind === 'consent' || (field.control === 'check' && kind === 'question')) {
    return left(kind, kind === 'consent' ? 'consent' : 'new');
  }
  if (isEqualOpportunity(kind)) {
    const answer = onFile.equalOpportunity[kind];
    if (!answer) return left(kind, 'sensitive');
    const picks = (EQUAL_OPPORTUNITY_PICKS[kind] as Record<string, string[]>)[answer] ?? [];
    return choosing(field)
      ? { kind, pick: picks, source: 'profile' }
      : { kind, text: picks[0] ?? '', source: 'profile' };
  }
  switch (kind) {
    case 'first-name':
      return fromProfile(kind, field, name.first);
    case 'last-name':
      return fromProfile(kind, field, name.last);
    case 'full-name':
      return fromProfile(kind, field, you.name);
    case 'preferred-name':
      return fromProfile(kind, field, applications.preferredName);
    case 'pronouns':
      return fromProfile(kind, field, applications.pronouns);
    case 'email':
      return fromProfile(kind, field, you.email);
    case 'phone':
      return fromProfile(kind, field, you.phone);
    case 'street':
      return fromProfile(kind, field, applications.street);
    case 'city':
      return fromProfile(kind, field, applications.city || place.city);
    case 'region':
      return fromProfile(kind, field, ...regionNames(applications.region || place.region));
    case 'postal-code':
      return fromProfile(kind, field, applications.postalCode);
    case 'country':
      return applications.country
        ? fromProfile(kind, field, ...countryNames(applications.country))
        : left(kind, 'unset');
    case 'location':
      // A list of countries, as some forms ask "your location" with, takes your country.
      if (field.control === 'choice' && field.options.length > 30) {
        return applications.country
          ? fromProfile(kind, field, ...countryNames(applications.country))
          : left(kind, 'unset');
      }
      return fromProfile(kind, field, you.location, place.city);
    case 'linkedin':
      return linkOrHandle(kind, field, you.linkedin);
    case 'github':
      return linkOrHandle(kind, field, applications.github);
    case 'website':
      return linkOrHandle(kind, field, you.website);
    case 'current-company':
      return onFile.resume?.company
        ? { ...fromProfile(kind, field, onFile.resume.company), source: 'resume' }
        : left(kind, 'unset');
    case 'current-title':
      return onFile.resume?.title
        ? { ...fromProfile(kind, field, onFile.resume.title), source: 'resume' }
        : left(kind, 'unset');
    case 'authorized':
      return yesNo(kind, field, authorizedFor(field, applications.countries));
    case 'sponsorship':
      return yesNo(kind, field, needsSponsorship(field, applications.sponsorship));
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
      const digits = onFile.targetPay.replace(/[^\d]/g, '');
      return field.control === 'number'
        ? digits
          ? { kind, text: digits, source: 'profile' }
          : left(kind, 'unset')
        : { kind, text: onFile.targetPay, source: 'profile' };
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
