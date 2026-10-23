import { Button, Field, Input } from '@factwright/ui';
import { useId } from 'react';
import { ANSWER_LIMITS, type AnswerChanges, type Contact } from '../../../shared/about.ts';
import styles from './steps.module.css';

const FIELDS: readonly {
  key: keyof Contact;
  label: string;
  hint?: string;
  type?: string;
  autoComplete: string;
  wide?: boolean;
}[] = [
  {
    key: 'name',
    label: 'Your name',
    hint: 'As it should read at the top of your resumes.',
    autoComplete: 'name',
    wide: true,
  },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  {
    key: 'location',
    label: 'Where you live',
    hint: 'Such as “Denver, CO”, or “Remote”.',
    autoComplete: 'address-level2',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn profile',
    hint: 'Such as linkedin.com/in/your-name.',
    autoComplete: 'url',
  },
  { key: 'website', label: 'Website or portfolio', autoComplete: 'url' },
];

/**
 * What a resume says that Profile leaves blank: each blank field the resume has, or null when it
 * has none of them.
 */
export function resumeFillIns(you: Contact, resume: Contact | null): Partial<Contact> | null {
  if (!resume) return null;
  const fills: Partial<Contact> = {};
  for (const { key } of FIELDS) {
    if (!you[key].trim() && resume[key].trim()) fills[key] = resume[key].trim();
  }
  return Object.keys(fills).length > 0 ? fills : null;
}

/** Each field, as a sentence names it. */
const FIELD_WORDS: Record<keyof Contact, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  location: 'where you live',
  linkedin: 'LinkedIn',
  website: 'website',
};

/** What a resume fills in, in words: "your name, email and phone". */
export function fillInWords(fills: Partial<Contact>): string {
  const words = FIELDS.filter(({ key }) => fills[key] !== undefined).map(
    ({ key }) => FIELD_WORDS[key],
  );
  if (words.length < 2) return `your ${words[0] ?? ''}`;
  return `your ${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * Who the user is, as their resumes should show it. Only the name is needed. Once Factwright has
 * made a resume, what it shows can fill in what's blank here, with one click.
 */
export function AboutYouStep({
  you,
  update,
  fromResume = null,
}: {
  you: Contact;
  update: (changes: AnswerChanges) => void;
  /** The contact details on the newest resume Factwright made, if it's made one. */
  fromResume?: Contact | null;
}) {
  const titleId = useId();
  const fills = resumeFillIns(you, fromResume);
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          About you
        </h2>
        <p className={styles.lead}>
          Your name and contact details, the way your resumes should show them. Leave out anything
          you’d rather not share; Claude can find the rest in your resumes.
        </p>
      </div>
      {fills && (
        <div className={styles.fromResume}>
          <p>Your newest resume has {fillInWords(fills)}.</p>
          <Button size="sm" onClick={() => update({ you: { ...you, ...fills } })}>
            Fill in from your resume
          </Button>
        </div>
      )}
      <div className={styles.fields}>
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            {...(field.hint && { hint: field.hint })}
            className={field.wide ? styles.wide : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                maxLength={ANSWER_LIMITS.line}
                value={you[field.key]}
                {...(field.key === 'name' && { 'data-autofocus': true, required: true })}
                onChange={(event) => update({ you: { ...you, [field.key]: event.target.value } })}
              />
            )}
          </Field>
        ))}
      </div>
    </section>
  );
}
