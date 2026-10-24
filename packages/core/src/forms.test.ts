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
      'over-18',
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
    // Options that only happen to name one aren't enough.
    expect(asked('Which colors do you like?', { options: ['White', 'Blue'] })).toBe('question');
  });

  it('keeps what it can’t tell in a part for self-identification for you, never to keep or draft', () => {
    const inPart = (question: string, section: string, control: FieldControl = 'combo') =>
      fieldKind({ ...field(question, { control }), section });
    expect(
      inPart('Please select one of the options below:', 'Voluntary Demographic Information'),
    ).toBe('personal');
    expect(inPart('Date Month', 'Self Identify', 'number')).toBe('personal');
    expect(inPart('Language', 'Voluntary Self-Identification of Disability')).toBe('personal');
    // What it can tell keeps its kind there: your name, and agreeing to the terms.
    expect(inPart('Name', 'Self Identify', 'text')).toBe('full-name');
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
      ]),
    ).toEqual(['never', 'never']);
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
      ]),
    ).toEqual(Array(7).fill('consent'));
    // Confirming your email isn't agreeing to anything.
    expect(kinds([['Confirm email', { type: 'email' }]])).toEqual(['email']);
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
