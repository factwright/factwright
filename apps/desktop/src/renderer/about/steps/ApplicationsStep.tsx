import type { ForApplications, KeptPrivate } from '@factwright/core';
import { Field, Input, Select, TagInput } from '@factwright/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { ANSWER_LIMITS, type AnswerChanges, OVER_18, SPONSORSHIP } from '../../../shared/about.ts';
import type { FactwrightApi } from '../../../shared/api.ts';
import { EQUAL_OPPORTUNITY_QUESTIONS } from '../../../shared/private.ts';
import styles from './steps.module.css';

/** How long it waits after typing stops to save what's kept on this computer. */
const SAVE_AFTER_MS = 500;

/** The lines Profile keeps for applications, with the rest of its answers. */
const LINES: readonly {
  key: Exclude<keyof ForApplications, 'countries' | 'sponsorship' | 'over18'>;
  label: string;
  hint?: string;
  autoComplete: string;
}[] = [
  {
    key: 'preferredName',
    label: 'Preferred first name',
    hint: 'If you go by one that isn’t on your resume.',
    autoComplete: 'nickname',
  },
  { key: 'pronouns', label: 'Pronouns', hint: 'Such as “she/her”.', autoComplete: 'off' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  {
    key: 'region',
    label: 'State or region',
    hint: 'Such as “CO”.',
    autoComplete: 'address-level1',
  },
  { key: 'country', label: 'Country', autoComplete: 'country-name' },
  { key: 'github', label: 'GitHub', hint: 'Such as github.com/your-name.', autoComplete: 'url' },
  {
    key: 'howHeard',
    label: 'How you heard about a job',
    hint: 'Said when where you found the job doesn’t say, such as “LinkedIn”.',
    autoComplete: 'off',
  },
];

/**
 * What application forms ask that a resume doesn't say, for the extension to fill them with:
 * names, where you live, links, and the questions forms ask about working there. Your street,
 * postal code and equal-opportunity answers are kept on this computer alone, and each
 * equal-opportunity question is left for you unless you choose an answer.
 */
export function ApplicationsStep({
  applications,
  update,
  api,
}: {
  applications: ForApplications;
  update: (changes: AnswerChanges) => void;
  api: Pick<FactwrightApi, 'privateAnswers' | 'savePrivateAnswers'>;
}) {
  const titleId = useId();
  const keptId = useId();
  const [kept, setKept] = useState<KeptPrivate | null>(null);
  const waiting = useRef<Partial<KeptPrivate>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = true;
    void api.privateAnswers().then((read) => {
      if (current) setKept(read);
    });
    return () => {
      current = false;
    };
  }, [api]);

  // What's waiting to be saved goes as the dialog closes, so nothing typed is lost.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(waiting.current).length > 0) void api.savePrivateAnswers(waiting.current);
    },
    [api],
  );

  const keep = (changes: Partial<KeptPrivate>) => {
    setKept((now) => (now ? { ...now, ...changes } : now));
    waiting.current = { ...waiting.current, ...changes };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const changed = waiting.current;
      waiting.current = {};
      void api.savePrivateAnswers(changed);
    }, SAVE_AFTER_MS);
  };

  const change = (changes: Partial<ForApplications>) =>
    update({ applications: { ...applications, ...changes } });

  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          For applications
        </h2>
        <p className={styles.lead}>
          What application forms ask that your resume doesn’t say. Factwright’s browser extension
          fills forms with these, and leaves anything blank here for you to answer on the form.
        </p>
      </div>

      <div className={styles.fields}>
        {LINES.map((line, at) => (
          <Field key={line.key} label={line.label} {...(line.hint && { hint: line.hint })}>
            {(control) => (
              <Input
                {...control}
                autoComplete={line.autoComplete}
                maxLength={ANSWER_LIMITS.line}
                value={applications[line.key]}
                {...(at === 0 && { 'data-autofocus': true })}
                onChange={(event) => change({ [line.key]: event.target.value })}
              />
            )}
          </Field>
        ))}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Working there</h3>
        <div className={styles.fields}>
          <Field
            label="Countries you can work in without a visa"
            hint="Press Enter after each one. Forms that ask if you can work there get Yes for these, and No for others."
            className={styles.wide}
          >
            {(control) => (
              <TagInput
                {...control}
                value={applications.countries}
                onChange={(countries) => change({ countries })}
                placeholder="Such as United States"
              />
            )}
          </Field>
          <Field label="Will you need a visa sponsored?">
            {(control) => (
              <Select
                {...control}
                value={applications.sponsorship}
                onChange={(event) =>
                  change({ sponsorship: event.target.value as ForApplications['sponsorship'] })
                }
              >
                {SPONSORSHIP.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Are you 18 or older?">
            {(control) => (
              <Select
                {...control}
                value={applications.over18}
                onChange={(event) =>
                  change({ over18: event.target.value as ForApplications['over18'] })
                }
              >
                {OVER_18.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      <section className={styles.section} aria-labelledby={keptId}>
        <h3 id={keptId} className={styles.sectionTitle}>
          Kept on this computer only
        </h3>
        <p className={styles.lead}>
          These never sync, and Claude never sees them. Each equal-opportunity question stays for
          you to answer on the form, unless you choose an answer here.
        </p>
        {kept && (
          <div className={styles.fields}>
            <Field label="Street address">
              {(control) => (
                <Input
                  {...control}
                  autoComplete="street-address"
                  maxLength={ANSWER_LIMITS.line}
                  value={kept.street}
                  onChange={(event) => keep({ street: event.target.value })}
                />
              )}
            </Field>
            <Field label="Postal code">
              {(control) => (
                <Input
                  {...control}
                  autoComplete="postal-code"
                  maxLength={ANSWER_LIMITS.line}
                  value={kept.postalCode}
                  onChange={(event) => keep({ postalCode: event.target.value })}
                />
              )}
            </Field>
            {EQUAL_OPPORTUNITY_QUESTIONS.map((question) => (
              <Field key={question.key} label={question.label}>
                {(control) => (
                  <Select
                    {...control}
                    value={kept.equalOpportunity[question.key]}
                    onChange={(event) =>
                      keep({
                        equalOpportunity: {
                          ...kept.equalOpportunity,
                          [question.key]: event.target.value,
                        },
                      })
                    }
                  >
                    {question.answers.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
