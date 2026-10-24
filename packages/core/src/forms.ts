/**
 * Application forms, as the extension reads them on a page you've asked it to fill. This is
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
  /**
   * The part of the form it's in, as the page names it, such as "Education" or "Employment", or
   * the outer part's name and the inner's, as "Work experience › Position 1", when the page has
   * them: "Start date" there is when you started a job or school, not when you can start.
   */
  section?: string;
  options: string[];
  required: boolean;
  limit: number | null;
}

/** What a field asks for, as far as Factwright can tell. */
export type FieldKind =
  // Who you are, from Profile.
  | 'first-name'
  | 'middle-name'
  | 'last-name'
  | 'full-name'
  | 'preferred-name'
  | 'pronouns'
  | 'email'
  | 'phone'
  // The country a phone number is in, as a form's box for its code asks it.
  | 'phone-country'
  | 'street'
  // A second line for an address, such as an apartment, which is yours to fill.
  | 'street-2'
  | 'city'
  | 'region'
  | 'postal-code'
  | 'country'
  | 'location'
  | 'linkedin'
  | 'github'
  | 'website'
  // Where you work now, from the job's own resume, or your newest.
  | 'current-company'
  | 'current-title'
  // A job you held, as a form asks for each one: when it started and ended, where, what you did
  // there, and whether you still hold it, which is yours to tick. The company and title are the
  // kinds above, the first time a form asks, and each time after.
  | 'job-start'
  | 'job-end'
  | 'job-location'
  | 'job-summary'
  | 'job-current'
  // When you started at a school, and where it is, which is yours to fill.
  | 'edu-start'
  | 'edu-location'
  // A month or year of a start or an end, in a part of the form that doesn't say whose.
  | 'block-date'
  // What your resumes say of your schools, your skills and you.
  | 'school'
  | 'degree'
  | 'discipline'
  | 'graduation'
  | 'gpa'
  | 'skills'
  | 'certifications'
  | 'summary'
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
  // Personal questions only you answer, each time, such as your sexual orientation, your age or a
  // criminal record: Factwright never fills them, and never keeps or reuses what you say.
  | 'personal'
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

/**
 * Words that ask for what's never filled: passwords and codes, payment details, ID numbers, and
 * birthdays, and a box only a robot would fill, as a page's trap for bots, such as Workday's
 * "This input is for robots only", or one that says only "Leave this field blank". A PIN code, as
 * India's postal codes are called, is a postal code.
 */
const NEVER =
  /\b(robots? only|if you( a)?re (a )?human|password|passcode|passphrase|social security|ssn|social insurance|sin number|national (id|identity|insurance)( number| card)?|(government|state)( issued)? id|id (number|no|card number)|identification (number|no)|passport (number|no|num|id|details)|drivers? licen[cs]e (number|no|id)|tax (id|number|file)|tin|itin|nhs number|medicare number|card number|credit card|debit card|cvv|cvc|security (code|question|answer)|secret (question|answer)|pin(?! ?code)|verification code|one time (code|password)|expiry date|expiration date|date of birth|birth ?date|birthday|dob|(year|month|day|place|country|city) of birth|birth (year|place|country)|bank account|account number|routing number|iban|swift|sort code|mothers maiden)\b|^(passport|id)$|^(please )?leave this (field |box |input )?(blank|empty)$|^(choose |create |pick )?(a |your )?(user ?name|login|login name|login id|user id)$/;

/**
 * Words a single checkbox asks you to agree to something with, as "I agree to the terms" does, or
 * to declare something true, as SmartRecruiters' declarations do.
 */
const AGREE =
  /\b(agree|consent|acknowledge|accept|certify|confirm|understand|terms|privacy|authori[sz]e|declare)\b/;

/**
 * The same asked any other way: by a choice, as "Do you acknowledge our privacy notice?" asks it,
 * or by typing your name as a signature. Agreeing is yours to do, whatever you said before.
 */
const CONSENT =
  /\b(i|you|do you|we) (hereby )?(agree|consent|acknowledge|certify|attest|accept the|declare)\b|\bconsent\b|\backnowledg(e|es|ed|ement)\b|\battest(ation)?\b|\bterms (and conditions|of (use|service|employment))\b|\bprivacy (policy|notice|statement)\b|\b(applicant|candidate|recruitment) privacy\b|\bdata (processing|retention|protection)\b|\bgdpr\b|\b(e ?)?signature\b|\bsign (here|below)\b|\b(keep|retain|store) (your|my) (data|information|details|application)\b/;

/** Words that ask whether you may work somewhere. */
const AUTHORIZED =
  /\b(legally )?(authori[sz]ed|eligible|permitted|entitled|able) to (lawfully )?work\b|\bright to work\b|\bwork (authori[sz]ation|permit|eligibility)\b|\bwork legally\b/;

/** Words that ask whether you can work without sponsorship, which is asking it the other way round. */
export const WITHOUT_SPONSORSHIP =
  /\bwithout (the need for |needing |requiring |any )*(visa |employer |company )?sponsor/;

/**
 * Rules that say what a field asks, by its question, in order: the first that fits is it. Each
 * has the words it looks for, any others it needs as well, and words that make it something
 * else, as "company name" isn't yours.
 */
const RULES: { kind: FieldKind; words: RegExp; also?: RegExp; not?: RegExp }[] = [
  // Equal-opportunity questions come first: "Are you Hispanic or Latino?" isn't a name. Each is
  // asked as a self-identification form asks it: "Do you need an accommodation for a disability?"
  // and "Describe your military service" aren't.
  {
    kind: 'hispanic',
    words:
      /\b(are you|identify as|of) (hispanic|latin[oax]|latine)\b|\bhispanic (or |and )?latin[oax]\b|\bhispanic (ethnicity|origin|heritage)\b|^(hispanic|latin[oax]|latine)( ethnicity)?$/,
    not: /\brace\b.*\b(white|black|asian)\b/,
  },
  { kind: 'race', words: /\b(race|racial|ethnicity|ethnic (group|background|origin))\b/ },
  {
    kind: 'gender',
    words: /\b(gender|sex)\b/,
    not: /\b(orientation|transgender|offen[cs]es?|offenders?|harass|crimes?|criminal|pay|diversity|diverse|balance|equality|discrimination)/,
  },
  {
    kind: 'veteran',
    words:
      /\bveteran (status|classification|self identification)\b|\b(are|were) you (a |an )?(protected |us |u s |military )?veteran\b|\bprotected veterans?\b|\bidentify as (a |an |one or more of the classifications of )?(protected )?veteran\b|^(protected )?veterans?( status)?$|\bhave you (ever )?served in the (us |u s |united states )?(military|armed forces)\b|\bmilitary (or )?veteran\b/,
    not: /\b(spouse|family|dependent|describe|tell us|explain|branch|rank|discharge|friendly|experience|program|benefits)\b/,
  },
  {
    kind: 'disability',
    words:
      /\bdisability (status|self identification|identification)\b|\b(do|did) you (have|had) (a |any )?disabilit(y|ies)\b|\bhave you (ever )?had a disability\b|\bare you disabled\b|\b(person|individual|someone) with a disability\b|\bidentify as (a person with a disability|having a disability|disabled)\b|\bconsider yourself (to have a disability|disabled)\b|^(disabilit(y|ies)|disabled)( status)?$|\bself identification of disability\b/,
    not: /\b(accommodat|adjustment|assist|support|describe|tell us|explain|need|require|help|interview|benefit)/,
  },
  { kind: 'pronouns', words: /\bpronouns?\b/ },
  {
    kind: 'over-18',
    words:
      /\b(18|eighteen) (years|or older|\+)|\bat least 18\b|\bover (the age of )?18\b|\blegal (working )?age\b/,
  },
  // Personal questions, which only you answer: who you love, your age, your health, your faith,
  // your family, or a criminal record. Factwright never keeps what you say to them.
  {
    kind: 'personal',
    words:
      /\bsexual(ity| orientation| identity)?\b|\borientation\b|\btransgender\b|\bcisgender\b|\blgbt[a-z]*\b|\bqueer\b|\bgender (expression|assigned)\b|^age$|\byour age\b|\bhow old\b|\bage (range|group|bracket)\b|\baccommodat(e|ion|ions)\b|\breasonable adjustments?\b|\b(health|medical) (conditions?|history|issues?|problems?|information|records?)\b|\bpregnan(t|cy)\b|\bvaccinat(ed|ion|ions)\b|\breligio(n|us)\b|\bmarital\b|\bmarried\b|\bspouse\b|\b(do you have|number of|how many) (children|kids|dependents)\b|\b(family|parental) status\b|\bnational origin\b|\b(convicted|conviction|convictions|criminal|felony|felonies|misdemeanou?rs?|arrested)\b|\b(union membership|trade union)\b|\bpolitical (affiliation|party|opinions?|views)\b/,
  },
  // Work questions Profile answers. Whether you're authorized and whether you need sponsorship,
  // asked together, take reading, as "Are you authorized to work here? If you need sponsorship,
  // answer No." does, so it's a question for you, unless it asks if you can work without it.
  { kind: 'authorized', words: AUTHORIZED, also: WITHOUT_SPONSORSHIP },
  {
    kind: 'sponsorship',
    words:
      /\bsponsor(ship|ed)?\b|\b(require|need) (a |an )?(work )?visa\b|\bvisa (support|sponsorship)\b/,
    not: /\b(authori[sz]ed|eligible|permitted|entitled|able) to (lawfully )?work\b|\bright to work\b|\bwork (authori[sz]ation|permit|eligibility)\b|\bhave you (ever )?been sponsored\b|\bpreviously sponsored\b/,
  },
  { kind: 'authorized', words: AUTHORIZED, not: /\bsponsor/ },
  {
    kind: 'relocation',
    words: /\brelocat(e|ion|ing)\b/,
    // Where you live now, or help with moving, isn't whether you'd move.
    not: /\b(located|live|living|based|reside|residing|local|commut(e|ing)|currently in|assistance|package|support|benefits?|stipend|reimburse)/,
  },
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
  // Schools, as a resume lists them, asked one field at a time. Whether you have a degree, or
  // have graduated, is a question for you.
  {
    kind: 'school',
    words:
      /^(school|university|college|institution|school name|university name|college name)$|\b(school|university|college|institution) (name|attended)\b|\bname of (your )?(school|university|college|institution)\b|\bwhere did you (study|go to school)\b/,
    not: /\b(high school diploma|do you|did you|have you|are you)\b/,
  },
  {
    kind: 'degree',
    words:
      /^(degree|degree type|degree level|qualification|highest degree)$|\bhighest (level of education|degree|qualification|education)\b|\b(level of education|education level)\b|\bdegree (obtained|earned|completed|attained|received)\b/,
    not: /\b(do you|did you|have you|are you|field|major|discipline|area)\b/,
  },
  {
    kind: 'discipline',
    words:
      /^(discipline|major|academic discipline|concentration|field of study|area of study|major field of study)$|\b(your|college|university|degree) major\b|\bfield of study\b|\barea of study\b/,
    not: /\b(minor|do you|did you|have you)\b/,
  },
  {
    kind: 'graduation',
    words:
      /\bgraduat(ion|ed) (date|year|month)\b|\b(date|year|month) (of )?graduat(ion|ed)\b|\bwhen did you graduate\b|^(expected )?graduation$|\bexpected graduation\b/,
    not: /\b(have you|did you|are you)\b/,
  },
  { kind: 'gpa', words: /\bgpa\b|\bgrade point average\b/ },
  // What a resume says, asked by name alone: "Skills", "Certifications", "Summary".
  {
    kind: 'skills',
    words:
      /^((key|technical|core|relevant|top|professional) )?skills( (and )?(expertise|competencies|technologies))?$|^(skill set|skillset|competencies|core competencies|areas of expertise)$/,
  },
  {
    kind: 'certifications',
    words:
      /^(licen[cs]es?( (and )?certifications?)?|certifications?( (and )?licen[cs]es?)?|professional certifications?|certificates)$/,
  },
  {
    kind: 'summary',
    words:
      /^(professional |career |executive )?summary$|^(professional profile|profile summary|short bio|bio)$/,
  },
  // Links.
  { kind: 'linkedin', words: /\blinked ?in\b/ },
  { kind: 'github', words: /\bgit ?hub\b/ },
  {
    kind: 'website',
    words: /\b(portfolio|personal (web ?site|site|page|url)|web ?site|homepage|home page|blog)\b/,
    not: /\b(other|company|employer|referr)/,
  },
  // Names: "company name" or "name of your school" are someone else's.
  { kind: 'middle-name', words: /\bmiddle (name|initial)s?\b/ },
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
  // Contact. A box for a phone number's country code, before the phone itself.
  {
    kind: 'phone-country',
    words:
      /\b(phone|mobile|dialing|calling) (number )?(country )?code\b|^country code$|^phone country$|\bcountry code\b/,
  },
  {
    kind: 'email',
    words: /\be ?mail\b/,
    not: /\b(referr|reference|manager|recruiter|emergency|contact person)/,
  },
  // The kind of phone, or its extension, as Workday asks them beside the number, isn't the number.
  {
    kind: 'phone',
    words: /\b(phone|mobile|cell ?phone|cell|telephone|tel)\b/,
    not: /\b(referr|reference|manager|recruiter|emergency|screen|interview)|\b(device|type|extension|ext)\b/,
  },
  // Where you live, an apartment or suite apart from the street.
  {
    kind: 'street-2',
    words:
      /\baddress (line )?(2|two)\b|\bsecond address line\b|\b(apartment|apt|suite|unit)( number| no)?\b/,
  },
  {
    kind: 'street',
    words:
      /\b(street|address line|mailing address|home address|street address)\b|^address( 1| line 1)?$/,
  },
  { kind: 'postal-code', words: /\b(zip|postal|post) ?(code)?\b|\bpostcode\b|\bpin ?code\b/ },
  { kind: 'city', words: /^(city|town)$|^(city|town) (of residence|you live in)$/ },
  {
    kind: 'region',
    words:
      /^(state|province|region|county|state province|state or province|prefecture)( of residence)?$/,
  },
  {
    kind: 'country',
    words:
      /^country( or region| region)?( of residence)?$|\bwhat country\b|\bwhich country (do you|are you)\b|\bcountry (are you|do you) (based|live|reside)\b/,
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
  { kind: 'middle-name', name: /\bmiddle ?name\b/ },
  { kind: 'last-name', name: /\b(last ?name|lname|surname|family ?name)\b/ },
  { kind: 'preferred-name', name: /\bpreferred ?name\b/ },
  { kind: 'email', name: /\be ?mail\b/ },
  { kind: 'phone', name: /\b(phone|mobile|tel)\b(?!.*\b(device|type|extension|ext)\b)/ },
  { kind: 'linkedin', name: /\blinked ?in\b/ },
  { kind: 'github', name: /\bgit ?hub\b/ },
  { kind: 'website', name: /\b(portfolio|website)\b/ },
  { kind: 'current-company', name: /^(org|company|current company)\b/ },
  { kind: 'resume', name: /\b(resume|cv)\b/ },
  { kind: 'cover-letter', name: /\bcover ?letter\b/ },
  { kind: 'gender', name: /^gender\b/ },
  { kind: 'hispanic', name: /^hispanic/ },
  { kind: 'race', name: /^(race|ethnicit)/ },
  { kind: 'veteran', name: /^veteran/ },
  // Workday's Self Identify names the form's own language "disabilityForm": that's no answer.
  { kind: 'disability', name: /^disabilit(y|ies)\b(?! form)/ },
  { kind: 'school', name: /\b(school|university|college)\b/ },
  { kind: 'degree', name: /\bdegree\b/ },
  { kind: 'discipline', name: /\b(discipline|major)\b/ },
  { kind: 'full-name', name: /^(name|full ?name|systemfield name)\b/ },
  { kind: 'location', name: /^(location|candidate location)\b/ },
];

/**
 * The equal-opportunity question a choice's options say it asks, when its words don't, as a
 * self-identification form's "Please check one of the boxes below:" asks about a disability by its
 * options alone: two or more of its options answer that question, and only it. Each is matched as
 * the option says it, in lowercase: a race is the whole option, or what comes before its brackets
 * or a dash, as "Asian (Not Hispanic or Latino)", never "Asian communities".
 */
const SELF_ID_OPTIONS: { kind: EqualOpportunityKind; option: RegExp }[] = [
  {
    kind: 'disability',
    option:
      /\bi (do not |don['’]?t )?have (a )?disabilit(y|ies)\b|\b(had|have had) (a disability|one) in the past\b/,
  },
  {
    kind: 'veteran',
    option: /\b(protected veterans?|i am not a veteran|not a veteran|veterans? listed above)\b/,
  },
  {
    kind: 'race',
    option:
      /^(american indian or alaska(n)? native|asian|black or african american|hispanic or latin[oax]|native hawaiian or (other )?pacific islander|two or more races|white)\s*($|[(:,–—-])/,
  },
  {
    kind: 'gender',
    option: /^(male|female|man|woman|men|women|non[- ]?binary)\s*($|[(:,–—-])/,
  },
];

/**
 * Words that only say how to answer, as "Please check one of the boxes below:" or "Select all that
 * apply" do, and leave what a choice asks to its options.
 */
const HOW_TO_ANSWER =
  /^((please )?(check|select|choose|pick|tick|mark)( (one|all|any|each|an?))?( (of|from))?( the)?( (boxes|box|options?|items?|answers?|choices?|following))?( (below|that apply|which apply|listed( below)?))?)?$/;

/**
 * A part of a form for self-identification, by its name: Workday's Voluntary Disclosures and Self
 * Identify, or an equal-opportunity or demographic part.
 */
const SELF_ID_PART =
  /\b(voluntary (self )?(disclosures?|identification|demographic)|self identif(y|ication)|equal (employment )?opportunit(y|ies)|eeoc?|demographics?|diversity)\b/;

/** Whether a field is in a part of the form for self-identification. */
const inSelfIdPart = (field: Pick<FormField, 'section'>) =>
  (field.section ?? '')
    .split(' › ')
    .map(plain)
    .some((part) => SELF_ID_PART.test(part));

/**
 * The equal-opportunity question a choice's options say it asks, or null: only for a question
 * nothing else tells, whose words only say how to answer, or that's in a part of the form for
 * self-identification, and never one whose words make it something else, as "Do you require an
 * accommodation?" isn't about a disability, whatever its options say.
 */
function selfIdByOptions(field: FieldToTell, question: string): EqualOpportunityKind | null {
  if (!HOW_TO_ANSWER.test(question) && !inSelfIdPart(field)) return null;
  const said = (field.options ?? []).map((each) => each.toLowerCase().trim());
  const kind =
    SELF_ID_OPTIONS.find(({ option }) => said.filter((each) => option.test(each)).length >= 2)
      ?.kind ?? null;
  if (!kind || RULES.some((rule) => rule.kind === kind && rule.not?.test(question))) return null;
  return kind;
}

/** A field's names and ids, as compared: "personalInfoUS--veteranStatus" is "personal info us veteran status". */
const allNames = (name: string) => plain(name.replace(/([a-z])([A-Z])/g, '$1 $2'));

/** What a name says after "--" when it only says which one it is: a number, or "select". */
const WHICH_ONE =
  /^((\d+|select|input|value|option|choice|field|answer|dropdown|radio|checkbox|text)( |$))*$/;

/**
 * A field's own names, as compared, without the part of the form a name says it's in first, as
 * Workday's "personalInfoUS--veteranStatus" puts it before "--": "veteran status". A name that
 * says only which one it is after "--", as "gender--0" or "race--select" does, keeps what's
 * before.
 */
const ownNames = (name: string) =>
  allNames(
    name
      .split(/\s+/)
      .map((each) => {
        const own = each.split('--').at(-1) ?? each;
        return WHICH_ONE.test(allNames(own)) ? each : own;
      })
      .join(' '),
  );

/**
 * The part of a form that asks for each job you held, by its heading, such as "Employment 2", or
 * SuccessFactors' "Outside Work Experience" and iCIMS's "Current Employment".
 */
const JOB_PART =
  /^(your |my )?(employment|employment history|employment information|current employment|((outside|previous|prior|past|relevant) )?work experience|work history|professional experience|experience|previous employment|job history)( \d{1,2})?( optional)?$/;

/** The part that asks for each school, by its heading, as SuccessFactors' "Formal Education". */
const SCHOOL_PART =
  /^(your |my )?((formal|college|higher) )?(education|education history|educational background|academic background|academic history|schools?|degrees?)( \d{1,2})?( optional)?$/;

/** A part that asks about someone else, by its heading: a reference, or who to call in an emergency. */
const OTHER_PART =
  /^(your |my )?((professional |personal )?(references?|referees?)|emergency contacts?|next of kin)( \d{1,2})?( optional)?$/;

/** What each field in a part for jobs asks, in order: the first that fits is it. */
const JOB_FIELDS: [FieldKind, RegExp][] = [
  [
    'job-current',
    /\b(i )?(currently|still) (work|working) here\b|\bcurrent(ly)? (role|position|job|employer)\b|^current$/,
  ],
  [
    'current-company',
    /^(company|company name|employer|employer name|organi[sz]ation|organi[sz]ation name)$/,
  ],
  ['current-title', /^(title|job title|position|position title|role|job role|job function)$/],
  [
    'job-start',
    /^(start|from|begin)\b|\b(start|begin) (date|month|year)\b|\bdate (started|from|begin)\b/,
  ],
  ['job-end', /^(end|to|until)\b|\bend (date|month|year)\b|\bdate (ended|to|end)\b/],
  ['job-location', /^(location|city|job location|work location|office location)$/],
  [
    'job-summary',
    /^(description|role description|job description|responsibility|responsibilities|duties|summary|what did you do)$/,
  ],
];

/** What each field in a part for schools asks. */
const SCHOOL_FIELDS: [FieldKind, RegExp][] = [
  ['school', /\b(school|university|college|institution)( name)?$/],
  [
    'discipline',
    /\b(field of study|major|discipline|area of study|concentration|branch of study)\b|^program(me)?$/,
  ],
  ['degree', /^(degree|degree type|degree level|qualification)$/],
  ['edu-start', /^(start|from|begin)\b|\b(start|begin) (date|month|year)\b|\bdate begin\b/],
  ['graduation', /^(end|to|until)\b|\bend (date|month|year)\b|\bdate end\b|\bgraduat/],
  ['gpa', /\bgpa\b|\bgrade point average\b/],
  ['edu-location', /^(location|city|school location|institution location)$/],
];

/**
 * Which part of a form a field's in, by the names of the parts it's in, the nearest first, or
 * else its own name: a job's, a school's, or none.
 */
export function fieldPart(
  field: Omit<FormField, 'options' | 'required' | 'limit'>,
): 'job' | 'school' | null {
  for (const section of (field.section ?? '').split(' › ').map(plain).reverse()) {
    if (SCHOOL_PART.test(section)) return 'school';
    if (JOB_PART.test(section)) return 'job';
  }
  const name = plain(field.name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (/\b(education|educations|school|schools)\b/.test(name)) return 'school';
  if (/\b(employment|employments|experience|experiences|work history)\b/.test(name)) return 'job';
  return null;
}

/** Whether a field is in a part of the form about someone else, so its name and phone are theirs. */
function forSomeoneElse(field: Omit<FormField, 'options' | 'required' | 'limit'>): boolean {
  return (
    (field.section ?? '').split(' › ').some((section) => OTHER_PART.test(plain(section))) ||
    /\b(references?|referees?|emergency contacts?)\b/.test(
      plain(field.name.replace(/([a-z])([A-Z])/g, '$1 $2')),
    )
  );
}

/** What a field in a part for jobs or schools asks, or null for anything else there. */
function partKind(field: Omit<FormField, 'options' | 'required' | 'limit'>): FieldKind | null {
  const part = fieldPart(field);
  if (!part) return null;
  const question = plain(field.question);
  const rules = part === 'job' ? JOB_FIELDS : SCHOOL_FIELDS;
  return rules.find(([, words]) => words.test(question))?.[0] ?? null;
}

/** A field as what it asks is told: its options, when it has them, tell more. */
type FieldToTell = Omit<FormField, 'options' | 'required' | 'limit'> & {
  options?: readonly string[];
};

/** The kinds that ask your name. */
const YOUR_NAME = new Set<FieldKind>(['full-name', 'first-name', 'last-name']);

/** A part of a form where your name signs it, as Taleo's eSignature: "eSignature", "Signature". */
const SIGNING_PART = /\b(e ?signatures?|signatures?)\b/;

/** Whether a field is in a part of the form where your name signs it. */
const inSigningPart = (field: Pick<FormField, 'section'>) =>
  (field.section ?? '')
    .split(' › ')
    .map(plain)
    .some((part) => SIGNING_PART.test(part));

/** The kinds that ask where you live. */
const WHERE_YOU_LIVE = new Set<FieldKind>([
  'street',
  'street-2',
  'city',
  'region',
  'postal-code',
  'country',
  'location',
]);

/**
 * What a field asks for, by its type, the browser's words for it, its question, its options and
 * its name. A field it can't tell is a question of the form's own, or, in a part of the form for
 * self-identification, a personal one. One that asks for a password, payment details, an ID number
 * or a date of birth is never filled, whatever else it says, and one that asks you to agree to
 * something is yours to answer, however it asks: a box among several that agrees, and your name
 * where it signs a self-identification form, as the "Name" beside the date it's signed on the US
 * government's disability form does. Options that answer an equal-opportunity question make one
 * that says nothing else one.
 */
export function fieldKind(field: FieldToTell): FieldKind {
  const kind = kindAsked(field);
  // Your name where it signs the form, a self-identification form or an application's eSignature.
  if (YOUR_NAME.has(kind) && (inSelfIdPart(field) || inSigningPart(field))) return 'consent';
  // Where a job or a school was, in its part, as iCIMS asks a job's country, is never your home.
  if (WHERE_YOU_LIVE.has(kind) && fieldPart(field)) return 'question';
  return kind;
}

/** What a field asks for, as fieldKind says, before your name signs anything. */
function kindAsked(field: FieldToTell): FieldKind {
  const question = plain(field.question);
  const said = `${question} ${plain(field.hint)}`;
  const type = field.type.toLowerCase();
  if (type === 'password') return 'never';
  const auto = AUTOCOMPLETE[field.autocomplete.toLowerCase().split(/\s+/).at(-1) ?? ''];
  if (auto === 'never') return 'never';
  if (NEVER.test(question)) return 'never';
  if (field.control === 'file') {
    if (/\b(cover|motivation(al)?) letter\b/.test(said)) return 'cover-letter';
    // A box that only says how to add a file is the part's it's in, as SmartRecruiters' Resume.
    const part = plain((field.section ?? '').split(' › ').at(-1) ?? '');
    if (
      /\b(resume|cv|curriculum vitae)\b/.test(said) ||
      /\b(resume|cv)\b/.test(plain(field.name)) ||
      (question === '' && /^(resume|cv|resume cv|cv resume)$/.test(part))
    ) {
      return 'resume';
    }
    return 'question';
  }
  if (field.control === 'check' && AGREE.test(question)) return 'consent';
  // A box among several that agrees to something is yours to tick too, as "I agree to a
  // background check" is under "Please confirm the following:".
  if (
    field.control === 'choices' &&
    (field.options ?? []).map(plain).some((each) => AGREE.test(each) || CONSENT.test(each))
  ) {
    return 'consent';
  }
  // In a part of the form for each job or school, "Start date" and "Location" are its own.
  const inPart = partKind(field);
  if (inPart) return inPart;
  // In a part about a reference or an emergency contact, "Name" and "Phone" are theirs.
  if (forSomeoneElse(field)) return 'question';
  // A month or year of a start or an end, with no part saying whose, is never your start date.
  if (/\b(start|end)\b/.test(question) && /\b(month|year)\b/.test(question)) return 'block-date';
  if (auto) return auto;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  if (CONSENT.test(question)) return 'consent';
  for (const rule of RULES) {
    if (
      rule.words.test(question) &&
      rule.also?.test(question) !== false &&
      !rule.not?.test(question)
    ) {
      if (rule.kind === 'cover-letter')
        return field.control === 'long' ? 'cover-letter-text' : 'question';
      return rule.kind;
    }
  }
  const byOptions = selfIdByOptions(field, question);
  if (byOptions) return byOptions;
  const name = ownNames(field.name);
  for (const each of NAMES) {
    if (each.name.test(name))
      return each.kind === 'resume' || each.kind === 'cover-letter' ? 'question' : each.kind;
  }
  // In a part for self-identification, as Workday's Voluntary Disclosures, a question it can't
  // tell is one only you answer: never a question of the form's own, to keep or to draft.
  if (inSelfIdPart(field)) return 'personal';
  return 'question';
}
