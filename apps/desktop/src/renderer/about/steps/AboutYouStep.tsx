import { Field, Input } from '@factwright/ui';
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

/** Who the user is, as their resumes should show it. Only the name is needed. */
export function AboutYouStep({
  you,
  update,
}: {
  you: Contact;
  update: (changes: AnswerChanges) => void;
}) {
  const titleId = useId();
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
