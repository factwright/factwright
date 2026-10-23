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
    ).toEqual(['current-company', 'question', 'question', 'question', 'question']);
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
