import { describe, expect, it } from 'vitest';
import { type FieldControl, type FieldKind, fieldKind } from './forms.ts';

/** A field as the extension reads one, with only what a test sets. */
const field = (
  question: string,
  more: {
    control?: FieldControl;
    type?: string;
    autocomplete?: string;
    name?: string;
    hint?: string;
  } = {},
) => ({
  question,
  hint: more.hint ?? '',
  control: more.control ?? 'text',
  type: more.type ?? 'text',
  autocomplete: more.autocomplete ?? '',
  name: more.name ?? '',
});

const kinds = (fields: [string, Parameters<typeof field>[1]?][]): FieldKind[] =>
  fields.map(([question, more]) => fieldKind(field(question, more)));

describe('what a field asks for', () => {
  it('knows a Greenhouse form’s fields', () => {
    expect(
      kinds([
        ['First Name', { autocomplete: 'given-name', name: 'first_name' }],
        ['Last Name', { autocomplete: 'family-name', name: 'last_name' }],
        ['Email', { autocomplete: 'email', name: 'email' }],
        ['Country', { control: 'combo', autocomplete: 'off', name: 'country' }],
        ['Phone', { type: 'tel', name: 'phone' }],
        ['Location (City)', { control: 'combo', name: 'candidate-location' }],
        ['Resume/CV', { control: 'file', type: 'file', name: 'resume' }],
        ['LinkedIn Profile', { name: 'question_12497118004' }],
        ['Other Website', { name: 'question_12497119004' }],
        ['Why do you want to join Harbor & Pine?', { control: 'long' }],
        ['Pronouns', { control: 'combo' }],
        [
          'Additional Information',
          { control: 'long', hint: 'Add a cover letter or anything else you’d like to share' },
        ],
        ['From where do you intend to work?', { hint: 'Please list city and state.' }],
        ['Preferred First Name'],
        ['Are you authorized to work in the country for which you applied?', { control: 'combo' }],
        [
          'Have you ever worked for Harbor & Pine before, as an employee or a contractor?',
          { control: 'combo' },
        ],
        ['Gender', { control: 'combo', name: 'gender' }],
        ['Are you Hispanic/Latino?', { control: 'combo', name: 'hispanic_ethnicity' }],
        ['Veteran Status', { control: 'combo', name: 'veteran_status' }],
        ['Disability Status', { control: 'combo', name: 'disability_status' }],
      ]),
    ).toEqual([
      'first-name',
      'last-name',
      'email',
      'country',
      'phone',
      'location',
      'resume',
      'linkedin',
      'question',
      'question',
      'pronouns',
      'question',
      'location',
      'preferred-name',
      'authorized',
      'question',
      'gender',
      'hispanic',
      'veteran',
      'disability',
    ]);
  });

  it('knows a Lever form’s fields', () => {
    expect(
      kinds([
        ['Resume/CV', { control: 'file', type: 'file', name: 'resume resume-upload-input' }],
        ['Full name', { name: 'name' }],
        ['Pronouns', { control: 'choices', type: 'checkbox', name: 'pronouns' }],
        ['Email', { type: 'email', name: 'email' }],
        ['Phone', { name: 'phone' }],
        ['Current location', { name: 'location location-input' }],
        ['Current company', { name: 'org' }],
        ['LinkedIn URL', { name: 'urls[LinkedIn]' }],
        ['GitHub URL', { name: 'urls[GitHub]' }],
        ['Portfolio URL', { name: 'urls[Portfolio]' }],
        ['Other website', { name: 'urls[Other]' }],
        [
          'Have you ever been previously employed by Harbor & Pine?',
          { control: 'choices', type: 'checkbox' },
        ],
        ['What is your location?', { control: 'choice' }],
        ['What best describes your gender?', { control: 'choice', type: 'radio' }],
        ['What is your race/ethnicity?:', { control: 'choice', type: 'radio' }],
        [
          'Are you a veteran/have you served in the military?',
          { control: 'choice', type: 'radio' },
        ],
        [
          'Harbor & Pine has my consent to contact me about future job opportunities.',
          { control: 'check', type: 'checkbox' },
        ],
      ]),
    ).toEqual([
      'resume',
      'full-name',
      'pronouns',
      'email',
      'phone',
      'location',
      'current-company',
      'linkedin',
      'github',
      'website',
      'question',
      'question',
      'location',
      'gender',
      'race',
      'veteran',
      'consent',
    ]);
  });

  it('knows an Ashby form’s fields', () => {
    expect(
      kinds([
        ['Name', { name: '_systemfield_name _systemfield_name' }],
        ['Email', { type: 'email', name: '_systemfield_email' }],
        ['Resume', { control: 'file', type: 'file', name: '_systemfield_resume' }],
        ['Cover letter', { control: 'long', hint: 'Tell us why you want to join our team!' }],
        ['Github', { hint: 'Please provide your GitHub username.' }],
        ['LinkedIn', { hint: 'Please provide the link to your LinkedIn profile.' }],
        ['X', { hint: 'Please provide the link to your X profile.' }],
        ['What country are you based in?'],
        ['Notice Period', { hint: 'What is your expected notice period?' }],
        ['Has someone here referred you for this role? If so, please include their name here:'],
      ]),
    ).toEqual([
      'full-name',
      'email',
      'resume',
      'cover-letter-text',
      'github',
      'linkedin',
      'question',
      'country',
      'start-date',
      'question',
    ]);
  });

  it('knows the work questions Profile answers', () => {
    expect(
      kinds([
        [
          'Will you now or in the future require sponsorship for employment visa status?',
          { control: 'choice' },
        ],
        ['Are you legally authorized to work in the United States?', { control: 'choice' }],
        ['Do you have the right to work in the UK?', { control: 'choice' }],
        ['Are you willing to relocate?', { control: 'choice' }],
        ['When can you start?'],
        ['How did you hear about this job?', { control: 'choice' }],
        ['What are your salary expectations?'],
        ['Desired compensation', { control: 'number', type: 'number' }],
        ['What is your current base salary?', { control: 'choice' }],
        ['Current compensation'],
        ['What do you currently earn?'],
        ['Are you at least 18 years of age?', { control: 'choice' }],
      ]),
    ).toEqual([
      'sponsorship',
      'authorized',
      'authorized',
      'relocation',
      'start-date',
      'how-heard',
      'pay',
      'pay',
      // What you're paid now isn't what you'd ask for.
      'question',
      'question',
      'question',
      'over-18',
    ]);
  });

  it('knows why you’re leaving, before where you work now, however a form asks it', () => {
    const leaving = [
      'Reason for leaving',
      'Reasons for Leaving',
      'Reason for leaving your current position',
      'What is your reason for leaving your current employer?',
      'What’s your reason for leaving?',
      'Why are you leaving?',
      'Why are you leaving your current job?',
      'Why did you leave?',
      'Why did you leave your last job?',
      'Why did you leave, or why are you leaving, your most recent position?',
      'Why are you looking?',
      'Why are you looking for a new role?',
      'Why are you currently looking for new opportunities?',
      'Why are you looking to leave your current role?',
      'Why are you seeking a new position?',
      'Reason for wanting to change',
      'Reason for wanting to change jobs',
      'Why do you want to leave your current employer?',
      'Why are you considering leaving your current role?',
      'Why do you want to change jobs?',
      'What prompted you to look for a new role?',
      'What made you start looking?',
      'Leaving reason',
      'Reason(s) for leaving current employer',
      'Please explain why you are leaving your current employer',
      'Tell us why you’re leaving your current role',
      'Briefly describe why you are leaving your current position',
      'Why did you leave or are you leaving your most recent employer?',
    ];
    for (const control of ['text', 'long'] as const) {
      expect(kinds(leaving.map((question) => [question, { control }]))).toEqual(
        leaving.map(() => 'leaving'),
      );
    }
    // Asked of each job in a part of the form for them, as iCIMS asks it, and by its name alone.
    expect(fieldKind({ ...field('Reason for Leaving'), section: 'Work Experience 2' })).toBe(
      'leaving',
    );
    expect(
      fieldKind({ ...field('Reason for leaving your current position'), section: 'Employment' }),
    ).toBe('leaving');
    expect(fieldKind(field('', { name: 'reasonForLeaving' }))).toBe('leaving');
    // What isn't: why the job, what you're after, when you'd leave, where you work now.
    expect(
      kinds([
        ['Why are you interested in this role?', { control: 'long' }],
        ['Why are you looking at Harbor & Pine?', { control: 'long' }],
        ['Why are you looking to join our team?', { control: 'long' }],
        ['What are you looking for in your next role?', { control: 'long' }],
        ['What prompted you to apply?', { control: 'long' }],
        ['Reason for applying'],
        ['When are you leaving your current job?'],
        ['Do you plan on leaving the area?', { control: 'choice' }],
        ['Have you taken a leave of absence?', { control: 'choice' }],
        ['Why do you want to move to Denver?'],
        [
          'Do you consent to us asking your current employer about your reason for leaving?',
          { control: 'choice' },
        ],
        ['Current employer'],
        ['Current job title'],
      ]),
    ).toEqual([
      'question',
      'question',
      'question',
      'question',
      'question',
      'question',
      'question',
      'question',
      'question',
      'question',
      'consent',
      'current-company',
      'current-title',
    ]);
    // Why the job, asked in words close to it, and leaving something other than a job.
    expect(
      kinds(
        [
          'Why are you seeking employment with Harbor & Pine?',
          'Why are you looking for a position at Harbor & Pine?',
          'Why are you looking for a new role at Harbor & Pine?',
          'Why are you searching for a role like this one?',
          'What led you to consider a role at Harbor & Pine?',
          'What motivated you to seek out this role?',
          'Why did you leave the military?',
          'Why have you left gaps in your employment?',
        ].map((question) => [question, { control: 'long' }]),
      ),
    ).toEqual(Array(8).fill('question'));
  });

  it('never takes a question about why you’re leaving as asking your title or company', () => {
    expect(
      kinds([
        ['Describe your departure from your current employer'],
        ['Explain why your current position is ending, if you have left'],
        ['Current company (leave blank if none)'],
        ['Current or most recent employer, if you have left'],
      ]),
    ).toEqual(['question', 'question', 'current-company', 'current-company']);
  });

  it('tells why you’re leaving as fast in a question a page made to be slow', () => {
    for (const question of [
      'why are you '.repeat(20_000),
      'reason for '.repeat(20_000),
      'what prompted you to '.repeat(10_000),
    ]) {
      const start = Date.now();
      fieldKind(field(question, { control: 'long' }));
      expect(Date.now() - start).toBeLessThan(1000);
    }
  });

  it('never takes a box for paragraphs as asking your title or company', () => {
    expect(
      kinds([
        ['Tell us about your current role', { control: 'long' }],
        ['Current company', { control: 'long' }],
        ['Most recent position', { control: 'long' }],
        ['Organization', { control: 'long', autocomplete: 'organization' }],
      ]),
    ).toEqual(['question', 'question', 'question', 'question']);
    expect(kinds([['Current company'], ['Most recent position']])).toEqual([
      'current-company',
      'current-title',
    ]);
  });

  it('never fills a password, payment details, an ID number or a date of birth', () => {
    expect(
      kinds([
        ['Create a password', { type: 'password' }],
        ['Password'],
        ['Social Security Number'],
        ['Last 4 digits of your SSN'],
        ['Date of birth', { control: 'date', type: 'date' }],
        ['Birthday', { autocomplete: 'bday' }],
        ['Card number'],
        ['Passport number'],
        ['Driver’s license number'],
        ['Bank account number'],
      ]),
    ).toEqual(Array(10).fill('never'));
    expect(
      kinds([
        ['ID number'],
        ['Government ID number'],
        ['Passport #'],
        ['PIN'],
        ['Security question answer'],
        ['Year of birth', { control: 'number', type: 'number' }],
      ]),
    ).toEqual(Array(6).fill('never'));
    // A question about having one is a question, not the number, and a PIN code is a postal code.
    expect(
      kinds([
        ['Do you have a valid driver’s license?', { control: 'choice' }],
        ['Do you hold a valid passport?', { control: 'choice' }],
        ['PIN code'],
        ['Do you have a security clearance?', { control: 'choice' }],
      ]),
    ).toEqual(['question', 'question', 'postal-code', 'question']);
  });

  it('keeps personal questions for you', () => {
    expect(
      kinds([
        ['Sexual orientation', { control: 'choice' }],
        ['Do you identify as transgender?', { control: 'choice' }],
        ['Do you identify as LGBTQ+?', { control: 'choice' }],
        ['What is your age?'],
        ['Do you need an accommodation for your interview?', { control: 'choice' }],
        ['Have you ever been convicted of a felony?', { control: 'choice' }],
        ['Marital status', { control: 'choice' }],
        ['Religion', { control: 'combo' }],
      ]),
    ).toEqual(Array(8).fill('personal'));
  });

  it('takes equal-opportunity questions only as a self-identification form asks them', () => {
    expect(
      kinds([
        ['Do you have a disability?', { control: 'choice' }],
        ['Are you a protected veteran?', { control: 'choice' }],
        ['Hispanic or Latino', { control: 'choice' }],
        ['What is your gender identity?', { control: 'combo' }],
      ]),
    ).toEqual(['disability', 'veteran', 'hispanic', 'gender']);
    expect(
      kinds([
        ['Do you need a disability accommodation for your interview?', { control: 'choice' }],
        ['Describe your military service, if any.', { control: 'long' }],
        ['Are you a military spouse?', { control: 'choice' }],
        ['Are you fluent in Spanish for our Latino customers?', { control: 'choice' }],
        ['Have you ever been convicted of a sex offense?', { control: 'choice' }],
      ]),
    ).toEqual(['personal', 'question', 'personal', 'question', 'personal']);
  });

  it('takes an equal-opportunity question by its options, or Workday’s names, whatever it says', () => {
    const asked = (
      question: string,
      more: { options?: string[]; name?: string; section?: string },
    ) => fieldKind({ ...field(question, { control: 'choices', name: more.name }), ...more });
    // Workday's Self Identify asks about a disability with boxes, as "Please check one".
    expect(
      asked('Please check one of the boxes below:', {
        options: [
          'Yes, I have a disability, or have had one in the past',
          'No, I do not have a disability and have not had one in the past',
          'I do not want to answer',
        ],
      }),
    ).toBe('disability');
    expect(
      asked('Please select all that apply.', {
        options: [
          'American Indian or Alaska Native (United States of America)',
          'Asian (United States of America)',
          'Black or African American (United States of America)',
        ],
      }),
    ).toBe('race');
    expect(
      asked('Please select one of the options below:', {
        options: ['I AM NOT A VETERAN', 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN'],
      }),
    ).toBe('veteran');
    // A dropdown shows no options until it's open: Workday names each one.
    for (const [name, kind] of [
      ['veteranStatus personalInfoUS--veteranStatus', 'veteran'],
      ['ethnicity personalInfoUS--ethnicity', 'race'],
      ['hispanicOrLatino personalInfoUS--hispanicOrLatino', 'hispanic'],
      ['gender personalInfoUS--gender', 'gender'],
    ] as const) {
      expect(asked('Please select one of the options below:', { name })).toBe(kind);
    }
    // What a part of the form names first, before "--", isn't the field's own name.
    expect(
      fieldKind(
        field('Date Month', {
          control: 'number',
          name: 'selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input',
        }),
      ),
    ).toBe('question');
    // A name that says only which one it is after "--" says what it asks before.
    expect(asked('Please select one of the options below:', { name: 'gender--0' })).toBe('gender');
    expect(asked('Please select one of the options below:', { name: 'race--select' })).toBe('race');
    // Options that only happen to name one aren't enough.
    expect(asked('Which colors do you like?', { options: ['White', 'Blue'] })).toBe('question');
  });

  it('never lets options make a question that says what it asks an equal-opportunity one', () => {
    const asked = (question: string, options: string[], section = '') =>
      fieldKind({ ...field(question, { control: 'choice' }), options, section });
    // Its words make it something else, whatever its options say, in any part of the form.
    for (const section of ['', 'Voluntary Disclosures']) {
      expect(
        asked(
          'Are you the spouse of a protected veteran?',
          [
            'Yes, I am the spouse of a protected veteran',
            'No, I am not the spouse of a protected veteran',
          ],
          section,
        ),
      ).toBe('personal');
      expect(
        asked(
          'Do you require a reasonable accommodation to take part in the hiring process?',
          ['Yes, I have a disability and need an accommodation', 'No, I do not have a disability'],
          section,
        ),
      ).toBe('personal');
    }
    // Options that name races, as communities, ask no one's race.
    const served = [
      'Black or African American communities',
      'American Indian or Alaska Native communities',
      'Asian communities',
    ];
    expect(asked('Which populations have you worked with?', served)).toBe('question');
    expect(asked('Please select all that apply.', served)).toBe('question');
    // A question that asks something of its own keeps it, outside a part for self-identification.
    expect(asked('Which of these teams would you like to coach?', ['Men', 'Women', 'Mixed'])).toBe(
      'question',
    );
  });

  it('leaves boxes that agree to something, among several, for you to tick', () => {
    const boxes = (question: string, options: string[]) =>
      fieldKind({ ...field(question, { control: 'choices' }), options });
    expect(
      boxes('Please confirm the following:', [
        'I certify that the information I have given is true',
        'I agree to a background check',
      ]),
    ).toBe('consent');
    expect(
      boxes('Please select all that apply.', [
        'Remote',
        'I have read the Applicant Privacy Notice',
      ]),
    ).toBe('consent');
    // Boxes that agree to nothing are a question of the form's own.
    expect(boxes('Which shifts can you work?', ['Mornings', 'Evenings', 'Weekends'])).toBe(
      'question',
    );
  });

  it('keeps what it can’t tell in a part for self-identification for you, never to keep or draft', () => {
    const inPart = (question: string, section: string, control: FieldControl = 'combo') =>
      fieldKind({ ...field(question, { control }), section });
    expect(
      inPart('Please select one of the options below:', 'Voluntary Demographic Information'),
    ).toBe('personal');
    expect(inPart('Date Month', 'Self Identify', 'number')).toBe('personal');
    expect(inPart('Language', 'Voluntary Self-Identification of Disability')).toBe('personal');
    // Your name there signs the form, as the disability form's "Name" beside its date does:
    // that's yours to do, as agreeing to the terms is.
    expect(inPart('Name', 'Self Identify', 'text')).toBe('consent');
    expect(inPart('Name', 'My Information › Legal Name', 'text')).toBe('full-name');
    expect(
      inPart(
        'Yes, I have read and consent to the terms and conditions',
        'Voluntary Disclosures',
        'check',
      ),
    ).toBe('consent');
    // Elsewhere, a question of the form's own.
    expect(inPart('How much travel are you open to?', 'Application Questions', 'choice')).toBe(
      'question',
    );
  });

  it('never fills a box only robots would, as a page’s trap for bots', () => {
    expect(
      kinds([
        [
          'Enter website. This input is for robots only, do not enter if you’re human.',
          { name: 'website' },
        ],
        ['Leave this field blank'],
        ['If you are human, leave this field blank.'],
        // A field you may leave blank isn't a trap.
        ['Middle name (leave it blank if you have none)'],
      ]),
    ).toEqual(['never', 'never', 'never', 'middle-name']);
  });

  it('tells working where you are from working without sponsorship', () => {
    expect(
      kinds([
        [
          'Are you legally authorized to work in the United States without the need for employer sponsorship?',
          { control: 'choice' },
        ],
        ['Are you authorized to work in the US? If you need sponsorship, answer No.'],
        ['Can you work here without sponsorship?', { control: 'choice' }],
        ['Are you located in the Denver area or willing to relocate?', { control: 'choice' }],
        ['Will you require relocation assistance?', { control: 'choice' }],
      ]),
    ).toEqual(['authorized', 'question', 'sponsorship', 'question', 'question']);
  });

  it('leaves agreeing to anything for you, however it’s asked', () => {
    expect(
      kinds([
        ['I agree to the privacy policy', { control: 'check', type: 'checkbox' }],
        ['I certify that the information above is true', { control: 'check', type: 'checkbox' }],
        ['Do you acknowledge our applicant privacy notice?', { control: 'choice' }],
        ['Do you consent to a background check?', { control: 'combo' }],
        ['Which of these do you agree to?', { control: 'choices', type: 'checkbox' }],
        ['Type your full name as your signature'],
        ['May we keep your information for future roles?', { control: 'long' }],
        [
          'I declare that the information in this application is true and complete.',
          { control: 'check', type: 'checkbox' },
        ],
        ['Do you declare that you have read the notice above?', { control: 'choice' }],
      ]),
    ).toEqual(Array(9).fill('consent'));
    // Confirming your email isn't agreeing to anything.
    expect(kinds([['Confirm email', { type: 'email' }]])).toEqual(['email']);
    // Nor is a box for new jobs by email, nor a list of which phone to call, your address or number.
    expect(
      kinds([
        [
          'Send an email notification whenever a new position matching this profile is posted.',
          { control: 'check', type: 'checkbox' },
        ],
        ['Preferred Phone', { control: 'choice' }],
        ['Preferred Phone Number'],
      ]),
    ).toEqual(['question', 'question', 'phone']);
  });

  it('keeps someone else’s name, email and phone apart from yours', () => {
    expect(
      kinds([
        ['Company name'],
        ['Name of your referrer'],
        ['Referrer’s email'],
        ['Emergency contact phone'],
        ['School name'],
      ]),
    ).toEqual(['current-company', 'question', 'question', 'question', 'school']);
  });

  it('knows what a resume answers: schools, skills, a summary', () => {
    expect(
      kinds([
        ['School'],
        ['Name of your university'],
        ['Degree', { control: 'combo' }],
        ['Highest level of education', { control: 'choice' }],
        ['Discipline', { control: 'combo' }],
        ['Field of study'],
        ['Graduation year'],
        ['GPA'],
        ['Skills', { control: 'long' }],
        ['Licenses & certifications'],
        ['Professional summary', { control: 'long' }],
      ]),
    ).toEqual([
      'school',
      'school',
      'degree',
      'degree',
      'discipline',
      'discipline',
      'graduation',
      'gpa',
      'skills',
      'certifications',
      'summary',
    ]);
    // Whether you have one is a question for you.
    expect(
      kinds([
        ['Do you have a bachelor’s degree?', { control: 'choice' }],
        ['Have you graduated?', { control: 'choice' }],
        ['Which of your skills make you a fit for this role?', { control: 'long' }],
      ]),
    ).toEqual(['question', 'question', 'question']);
  });

  it('knows a middle name, an address’s second line and a phone’s country code apart', () => {
    expect(
      kinds([
        ['Middle name'],
        ['Address line 2'],
        ['Apartment, suite, etc.'],
        ['Country code', { control: 'combo' }],
        ['Address line 1'],
        // Workday asks the kind of phone, its country's code and its extension beside the number,
        // each with a name that says phone.
        ['Phone Device Type', { control: 'combo', name: 'phoneNumber--phoneType' }],
        ['Country Phone Code', { control: 'combo', name: 'phoneNumber--countryPhoneCode' }],
        ['Phone Number', { name: 'phoneNumber--phoneNumber' }],
        ['Phone Extension', { name: 'phoneNumber--extension' }],
        ['Country/Region', { control: 'combo', name: 'country country--country' }],
        [
          'Language',
          { control: 'combo', name: 'disabilityForm selfIdentifiedDisabilityData--disabilityForm' },
        ],
      ]),
    ).toEqual([
      'middle-name',
      'street-2',
      'street-2',
      'phone-country',
      'street',
      'question',
      'phone-country',
      'phone',
      'question',
      'country',
      // Self Identify's language, which Workday names "disabilityForm", asks no one's disability.
      'question',
    ]);
  });

  it('knows what a part of the form for each job or school asks, by its heading or name', () => {
    const inPart = (
      question: string,
      section: string,
      more: { name?: string; control?: FieldControl } = {},
    ) => fieldKind({ ...field(question, more), section });
    expect(
      ['Company name', 'Title', 'Start date month', 'End date year', 'Location', 'Description'].map(
        (question) => inPart(question, 'Employment'),
      ),
    ).toEqual([
      'current-company',
      'current-title',
      'job-start',
      'job-end',
      'job-location',
      'job-summary',
    ]);
    expect(inPart('I currently work here', 'Work experience', { control: 'check' })).toBe(
      'job-current',
    );
    expect(
      ['School', 'Degree', 'Field of study', 'Start date year', 'End date year', 'Location'].map(
        (question) => inPart(question, 'Education'),
      ),
    ).toEqual(['school', 'degree', 'discipline', 'edu-start', 'graduation', 'edu-location']);
    // Its name says which part when no heading does.
    expect(fieldKind(field('Start date', { name: 'employment[0][start_date]' }))).toBe('job-start');
    // A month or year with nothing saying whose is never when you can start.
    expect(fieldKind(field('Start date year'))).toBe('block-date');
    expect(fieldKind(field('Start date'))).toBe('start-date');
    // A form's own heading over every field says nothing of the part a field's in.
    expect(inPart('Location', 'Apply for this job')).toBe('location');
  });

  it('knows a part by its heading as forms put it: numbered, yours, or inside another', () => {
    const inPart = (question: string, section: string) =>
      fieldKind({ ...field(question), section });
    expect(inPart('Company', 'Work Experience 2')).toBe('current-company');
    expect(inPart('Employer', 'Your employment history')).toBe('current-company');
    expect(inPart('School', 'Education (optional)')).toBe('school');
    expect(inPart('Start date Month', 'Work experience › Position 1')).toBe('job-start');
    expect(inPart('Start date Year', 'Education › Degree 1')).toBe('edu-start');
    // The nearest part says, before the one around it.
    expect(inPart('Location', 'Work experience › Education')).toBe('edu-location');
    // A heading that only mentions employment isn't a part for each job.
    expect(inPart('Location', 'Previous Harbor & Pine Employment')).toBe('location');
  });

  it('knows the parts for jobs and schools as iCIMS, Taleo, SuccessFactors and SmartRecruiters name them', () => {
    const inPart = (question: string, section: string, more: { control?: FieldControl } = {}) =>
      fieldKind({ ...field(question, more), section });
    // SuccessFactors' rows, its own words.
    expect(
      ['Company Name', 'Job Title', 'Date Begin', 'End Date', 'Location'].map((question) =>
        inPart(question, 'Outside Work Experience'),
      ),
    ).toEqual(['current-company', 'current-title', 'job-start', 'job-end', 'job-location']);
    expect(
      ['School', 'Degree', 'Major', 'Date Begin', 'End Date'].map((question) =>
        inPart(question, 'Formal Education'),
      ),
    ).toEqual(['school', 'degree', 'discipline', 'edu-start', 'graduation']);
    // Taleo's: a job's title is its "Job Function", and a school's field its "Program".
    expect(
      ['Employer', 'Job Function', 'Responsibility'].map((question) =>
        inPart(question, 'Work Experience 1'),
      ),
    ).toEqual(['current-company', 'current-title', 'job-summary']);
    expect(inPart('Current Employer', 'Work Experience 1', { control: 'check' })).toBe(
      'job-current',
    );
    expect(inPart('Program', 'Education 1')).toBe('discipline');
    // iCIMS's, numbered as "(1)", where a job's country and state are where it was, not your home.
    expect(
      ['Employer', 'Start Date Month', 'Country', 'State', 'Postal Code', 'City'].map((question) =>
        inPart(question, 'Work Experience › Professional Experience (1)'),
      ),
    ).toEqual(['current-company', 'job-start', 'question', 'question', 'question', 'job-location']);
    expect(inPart('School', 'College Education (1)')).toBe('school');
    expect(inPart('Company', 'Current Employment')).toBe('current-company');
    // SmartRecruiters' editor for each job and school.
    expect(
      ['Title', 'Company', 'Office location', 'From', 'To'].map((question) =>
        inPart(question, 'Experience 2'),
      ),
    ).toEqual(['current-title', 'current-company', 'job-location', 'job-start', 'job-end']);
    expect(inPart('School location', 'Education 1')).toBe('edu-location');
    // Your own address, outside those parts, is yours.
    expect(inPart('Country', 'Addresses (1)')).toBe('country');
  });

  it('leaves a user name and your name where it signs the application for you', () => {
    expect(
      ['Login', 'User Name', 'Choose a username'].map((each) => fieldKind(field(each))),
    ).toEqual(['never', 'never', 'never']);
    expect(fieldKind({ ...field('Full Name'), section: 'eSignature' })).toBe('consent');
    expect(fieldKind({ ...field('Full Name'), section: 'Personal Information' })).toBe('full-name');
  });

  it('takes a box to add a file in a part for your resume as your resume', () => {
    const file = (question: string, section: string) =>
      fieldKind({ ...field(question, { control: 'file' }), section });
    expect(file('', 'Resume')).toBe('resume');
    expect(file('', 'Easy Apply › Resume/CV')).toBe('resume');
    expect(file('', 'Portfolio')).toBe('question');
    expect(file('Cover letter', 'Resume')).toBe('cover-letter');
  });

  it('never takes a reference’s or an emergency contact’s name and phone for yours', () => {
    const inPart = (question: string, section: string, more: { type?: string } = {}) =>
      fieldKind({ ...field(question, more), section });
    expect([
      inPart('Name', 'References'),
      inPart('Phone', 'Professional reference 2', { type: 'tel' }),
      inPart('Email', 'Application › Emergency contact', { type: 'email' }),
      fieldKind(field('Full name', { name: 'reference_1_name' })),
    ]).toEqual(['question', 'question', 'question', 'question']);
    expect(inPart('Name', 'Contact details')).toBe('full-name');
  });

  it('goes by the browser’s own words for a field, and its name, when its question says little', () => {
    expect(
      kinds([
        ['', { autocomplete: 'section-home shipping street-address' }],
        ['', { autocomplete: 'postal-code' }],
        ['Your answer', { name: 'firstName' }],
        ['', { name: 'urls[LinkedIn]' }],
      ]),
    ).toEqual(['street', 'postal-code', 'first-name', 'linkedin']);
  });

  it('takes a file it can’t tell as a question, never a resume', () => {
    expect(kinds([['Transcript', { control: 'file', type: 'file' }]])).toEqual(['question']);
    expect(kinds([['Cover Letter', { control: 'file', type: 'file' }]])).toEqual(['cover-letter']);
  });
});
