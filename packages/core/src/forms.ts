/**
 * Application forms, as Save to Factwright reads them on a page you've asked it to fill. This is
 * what each field asks for, by its words, which the extension and the app agree on: Factwright
 * answers a field it knows from what's on file, and leaves the rest for you or your Claude.
 */

/** How a field takes its answer, as the page shows it. */
export type FieldControl =
  | 'text'
  | 'long'
  | 'number'
  | 'date'
  | 'choice'
  | 'choices'
  | 'check'
  | 'combo'
  | 'file';

export const FIELD_CONTROLS: readonly FieldControl[] = [
  'text',
  'long',
  'number',
  'date',
  'choice',
  'choices',
  'check',
  'combo',
  'file',
];

/** A field as the extension read it: what it asks, how it takes its answer, and its options. */
export interface FormField {
  question: string;
  hint: string;
  control: FieldControl;
  /** Its own type, as an input has one, such as "email" or "tel". */
  type: string;
  /** What the page says the browser may fill it with, such as "given-name". */
  autocomplete: string;
  /** Its name and id, such as "first_name" or "urls[LinkedIn]". */
  name: string;
  options: string[];
  required: boolean;
  limit: number | null;
}

/** What a field asks for, as far as Factwright can tell. */
export type FieldKind =
  // Who you are, from Profile.
  | 'first-name'
  | 'last-name'
  | 'full-name'
  | 'preferred-name'
  | 'pronouns'
  | 'email'
  | 'phone'
  | 'street'
  | 'city'
  | 'region'
  | 'postal-code'
  | 'country'
  | 'location'
  | 'linkedin'
  | 'github'
  | 'website'
  // Where you work now, from the job's own resume.
  | 'current-company'
  | 'current-title'
  // Questions Profile answers.
  | 'authorized'
  | 'sponsorship'
  | 'start-date'
  | 'relocation'
  | 'how-heard'
  | 'pay'
  | 'over-18'
  // Equal-opportunity questions: only from what you set in Profile, and never shown to Claude.
  | 'gender'
  | 'hispanic'
  | 'race'
  | 'veteran'
  | 'disability'
  // The job's own files.
  | 'resume'
  | 'cover-letter'
  // A cover letter to type or paste in.
  | 'cover-letter-text'
  // Agreeing to something, which is yours to do.
  | 'consent'
  // What Factwright never fills: passwords, payment details, ID numbers and dates of birth.
  | 'never'
  // Anything else: a question of the form's own.
  | 'question';

/** The equal-opportunity questions, which Factwright fills only from what you set in Profile. */
export const EQUAL_OPPORTUNITY_KINDS = [
  'gender',
  'hispanic',
  'race',
  'veteran',
  'disability',
] as const satisfies readonly FieldKind[];

export type EqualOpportunityKind = (typeof EQUAL_OPPORTUNITY_KINDS)[number];

/** Whether a kind of field is an equal-opportunity question. */
export const isEqualOpportunity = (kind: FieldKind): kind is EqualOpportunityKind =>
  (EQUAL_OPPORTUNITY_KINDS as readonly FieldKind[]).includes(kind);

/** What a field's words and attributes are, as compared: lowercase, letters and digits. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The kinds the browser's own words for a field give, by its autocomplete's last word. */
const AUTOCOMPLETE: Record<string, FieldKind> = {
  'given-name': 'first-name',
  'family-name': 'last-name',
  name: 'full-name',
  nickname: 'preferred-name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'street-address': 'street',
  'address-line1': 'street',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postal-code',
  country: 'country',
  'country-name': 'country',
  organization: 'current-company',
  'organization-title': 'current-title',
  url: 'website',
  bday: 'never',
  'bday-day': 'never',
  'bday-month': 'never',
  'bday-year': 'never',
  'new-password': 'never',
  'current-password': 'never',
  'one-time-code': 'never',
};

/** Words that ask for what's never filled: passwords, payment details, ID numbers, birthdays. */
const NEVER =
  /\b(password|passcode|social security|ssn|social insurance|sin number|national (id|insurance)( number)?|passport (number|no)|drivers? licen[cs]e (number|no|id)|tax (id|number|file)|tin|card number|credit card|debit card|cvv|cvc|security code|expiry date|expiration date|date of birth|birth ?date|birthday|dob|bank account|account number|routing number|iban|swift|sort code|mothers maiden)\b/;

/**
 * Rules that say what a field asks, by its question, in order: the first that fits is it. Each
 * has the words it looks for, and words that make it something else, as "company name" isn't
 * yours.
 */
const RULES: { kind: FieldKind; words: RegExp; not?: RegExp; short?: number }[] = [
  // Equal-opportunity questions come first: "Are you Hispanic or Latino?" isn't a name.
  {
    kind: 'hispanic',
    words: /\b(hispanic|latin[oax]|latine)\b/,
    not: /\brace\b.*\b(white|black|asian)\b/,
  },
  { kind: 'race', words: /\b(race|racial|ethnicity|ethnic (group|background|origin))\b/ },
  {
    kind: 'gender',
    words: /\b(gender|sex)\b/,
    not: /\b(orientation|identity as transgender|transgender|offender|harass)/,
  },
  {
    kind: 'veteran',
    words: /\b(veteran|military service|served in the (military|armed forces)|armed forces)\b/,
  },
  { kind: 'disability', words: /\bdisabilit(y|ies)|disabled\b/ },
  { kind: 'pronouns', words: /\bpronouns?\b/ },
  {
    kind: 'over-18',
    words:
      /\b(18|eighteen) (years|or older|\+)|\bat least 18\b|\bover (the age of )?18\b|\blegal (working )?age\b/,
  },
  // Work questions Profile answers.
  {
    kind: 'sponsorship',
    words:
      /\bsponsor(ship|ed)?\b|\b(require|need) (a |an )?(work )?visa\b|\bvisa (support|sponsorship)\b/,
  },
  {
    kind: 'authorized',
    words:
      /\b(legally )?(authori[sz]ed|eligible|permitted|entitled|able) to (lawfully )?work\b|\bright to work\b|\bwork (authori[sz]ation|permit|eligibility)\b|\bwork legally\b/,
  },
  { kind: 'relocation', words: /\brelocat(e|ion|ing)\b/ },
  {
    kind: 'start-date',
    words:
      /\bstart(ing)? date\b|\bwhen (can|could|would) you (start|begin|join)\b|\bavailable to (start|begin|join)\b|\bearliest (start|date|available)\b|\bavailability date\b|\bnotice period\b|\bdate (you are|youre) available\b/,
  },
  {
    kind: 'how-heard',
    words:
      /\bhow did you (hear|find|learn|come across|discover)\b|\bwhere did you (hear|find|see|learn|discover)\b|\bhear about (us|this|the)\b|\b(referral|application|candidate|lead) source\b|\bsource of (this )?(application|referral)\b|\bhow (were you|have you been) referred\b/,
  },
  {
    kind: 'pay',
    words:
      /\b(salary|compensation|pay|wage|rate) (expectations?|requirements?|range|desired|requested)\b|\b(desired|expected|target|minimum|requested) (base )?(salary|compensation|pay|wage|rate)\b|\bsalary\b|\bcompensation\b/,
    not: /\b(history|current salary|prior|previous)\b/,
  },
  // Cover letters, to type or upload.
  { kind: 'cover-letter', words: /\b(cover|motivation(al)?) letter\b/ },
  // Links.
  { kind: 'linkedin', words: /\blinked ?in\b/ },
  { kind: 'github', words: /\bgit ?hub\b/ },
  {
    kind: 'website',
    words: /\b(portfolio|personal (web ?site|site|page|url)|web ?site|homepage|home page|blog)\b/,
    not: /\b(other|company|employer|referr)/,
  },
  // Names: "company name" or "name of your school" are someone else's.
  {
    kind: 'preferred-name',
    words:
      /\b(preferred|chosen) (first )?name\b|\bnick ?name\b|\bgo(es)? by\b|\bname you (go by|prefer)\b/,
  },
  {
    kind: 'first-name',
    words: /\b(first|given) name\b|\bforename\b|\bfirst$/,
    not: /\b(company|employer|school|referr|emergency|reference|manager|recruiter|contact)/,
  },
  {
    kind: 'last-name',
    words: /\b(last|family) name\b|\bsurname\b|\blast$/,
    not: /\b(company|employer|school|referr|emergency|reference|manager|recruiter|contact)/,
  },
  {
    kind: 'current-company',
    words:
      /\b(current|present|most recent) (company|employer|organi[sz]ation)\b|\bcompany name\b|\bemployer\b|^company$|^organi[sz]ation$/,
    not: /\b(previous|prior|past|referr|worked for|employed by|ever)/,
  },
  {
    kind: 'current-title',
    words: /\b(current|present|most recent) (job )?(title|role|position)\b|^(job )?title$/,
  },
  {
    kind: 'full-name',
    words:
      /^(your )?(full |legal |complete )?name$|^name and surname$|\bfull name\b|\blegal name\b/,
    not: /\b(company|employer|school|university|referr|emergency|reference|manager|recruiter|contact|preferred)/,
  },
  // Contact.
  {
    kind: 'email',
    words: /\be ?mail\b/,
    not: /\b(referr|reference|manager|recruiter|emergency|contact person)/,
  },
  {
    kind: 'phone',
    words: /\b(phone|mobile|cell ?phone|cell|telephone|tel)\b/,
    not: /\b(referr|reference|manager|recruiter|emergency|screen|interview)/,
  },
  // Where you live.
  {
    kind: 'street',
    words:
      /\b(street|address line|mailing address|home address|street address)\b|^address( 1| line 1)?$/,
  },
  { kind: 'postal-code', words: /\b(zip|postal|post) ?(code)?\b|\bpostcode\b/ },
  { kind: 'city', words: /^(city|town)$|^(city|town) (of residence|you live in)$/ },
  {
    kind: 'region',
    words:
      /^(state|province|region|county|state province|state or province|prefecture)( of residence)?$/,
  },
  {
    kind: 'country',
    words:
      /^country( of residence)?$|\bwhat country\b|\bwhich country (do you|are you)\b|\bcountry (are you|do you) (based|live|reside)\b/,
    not: /\b(authori[sz]ed|eligible|citizen|passport)\b/,
  },
  {
    kind: 'location',
    words:
      /\blocation\b|\bwhere (are you|do you) (currently )?(located|live|based|reside)\b|\bwhere (do you|will you) intend to work\b|\bfrom where\b|\bcity (and|,)? state\b|\bcurrently (based|located|reside)\b|\bwhere you live\b/,
    not: /\b(relocat|preferred|willing|office|open to)\b/,
  },
];

/** What a name or id says a field is: "first_name", "urls[LinkedIn]", "_systemfield_email". */
const NAMES: { kind: FieldKind; name: RegExp }[] = [
  { kind: 'first-name', name: /\b(first ?name|fname|given ?name)\b/ },
  { kind: 'last-name', name: /\b(last ?name|lname|surname|family ?name)\b/ },
  { kind: 'preferred-name', name: /\bpreferred ?name\b/ },
  { kind: 'email', name: /\be ?mail\b/ },
  { kind: 'phone', name: /\b(phone|mobile|tel)\b/ },
  { kind: 'linkedin', name: /\blinked ?in\b/ },
  { kind: 'github', name: /\bgit ?hub\b/ },
  { kind: 'website', name: /\b(portfolio|website)\b/ },
  { kind: 'current-company', name: /^(org|company|current company)\b/ },
  { kind: 'resume', name: /\b(resume|cv)\b/ },
  { kind: 'cover-letter', name: /\bcover ?letter\b/ },
  { kind: 'gender', name: /^gender\b/ },
  { kind: 'hispanic', name: /^hispanic/ },
  { kind: 'race', name: /^race\b/ },
  { kind: 'veteran', name: /^veteran/ },
  { kind: 'disability', name: /^disability/ },
  { kind: 'full-name', name: /^(name|full ?name|systemfield name)\b/ },
  { kind: 'location', name: /^(location|candidate location)\b/ },
];

/**
 * What a field asks for, by its type, the browser's words for it, its question and its name. A
 * field it can't tell is a question of the form's own. One that asks for a password, payment
 * details, an ID number or a date of birth is never filled, whatever else it says.
 */
export function fieldKind(field: Omit<FormField, 'options' | 'required' | 'limit'>): FieldKind {
  const question = plain(field.question);
  const said = `${question} ${plain(field.hint)}`;
  const type = field.type.toLowerCase();
  if (type === 'password') return 'never';
  const auto = AUTOCOMPLETE[field.autocomplete.toLowerCase().split(/\s+/).at(-1) ?? ''];
  if (auto === 'never') return 'never';
  if (NEVER.test(question)) return 'never';
  if (field.control === 'file') {
    if (/\b(cover|motivation(al)?) letter\b/.test(said)) return 'cover-letter';
    if (
      /\b(resume|cv|curriculum vitae)\b/.test(said) ||
      /\b(resume|cv)\b/.test(plain(field.name))
    ) {
      return 'resume';
    }
    return 'question';
  }
  if (field.control === 'check') {
    if (
      /\b(agree|consent|acknowledge|accept|certify|confirm|understand|terms|privacy|authori[sz]e)\b/.test(
        question,
      )
    ) {
      return 'consent';
    }
  }
  if (auto) return auto;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  for (const rule of RULES) {
    if (rule.words.test(question) && !rule.not?.test(question)) {
      if (rule.kind === 'cover-letter')
        return field.control === 'long' ? 'cover-letter-text' : 'question';
      return rule.kind;
    }
  }
  const name = plain(field.name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  for (const each of NAMES) {
    if (each.name.test(name))
      return each.kind === 'resume' || each.kind === 'cover-letter' ? 'question' : each.kind;
  }
  return 'question';
}
