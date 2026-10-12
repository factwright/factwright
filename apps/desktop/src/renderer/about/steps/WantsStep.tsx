import { Checkbox, ChipGroup, Field, Input, Select, TagInput, TextArea } from '@factwright/ui';
import { useId } from 'react';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  COMPANY_KINDS,
  EMPLOYMENT,
  FIELDS,
  LEVELS,
  RELOCATE,
  WORKPLACES,
} from '../../../shared/about.ts';
import styles from './steps.module.css';

const options = <T extends string>(list: readonly (readonly [T, string, ...string[]])[]) =>
  list.map(([value, label]) => ({ value, label }));

/**
 * What the user is looking for, as fully as they'll say: the work, the level, where, the kinds of
 * company and industry, pay and terms, and what makes or breaks a job. Job searches and fit
 * checks go by it, and the resumes aim at it.
 */
export function WantsStep({
  answers,
  update,
}: {
  answers: AboutYou;
  update: (changes: AnswerChanges) => void;
}) {
  const titleId = useId();
  const remote = answers.workplaces.includes('remote');
  const local = answers.workplaces.some((place) => place !== 'remote');
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          What you want
        </h2>
        <p className={styles.lead}>
          The more you say, the better Claude can find and rank jobs for you. Skip anything you’re
          not sure about; you can change all of it later in Profile.
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>The work</h3>
        <Field
          label="Job titles you want"
          hint="Press Enter after each one. Close matches count too."
        >
          {(control) => (
            <TagInput
              {...control}
              value={answers.roles}
              onChange={(roles) => update({ roles })}
              placeholder="Such as Product Designer"
            />
          )}
        </Field>
        <ChipGroup
          label="Kinds of work"
          options={options(FIELDS)}
          value={answers.fields}
          onChange={(fields) => update({ fields })}
        />
        <ChipGroup
          label="Levels"
          hint="Pick every level you’d take."
          options={options(LEVELS)}
          value={answers.levels}
          onChange={(levels) => update({ levels })}
        />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Where</h3>
        <ChipGroup
          label="How you’d work"
          options={options(WORKPLACES)}
          value={answers.workplaces}
          onChange={(workplaces) => update({ workplaces })}
        />
        <div className={styles.fields}>
          {remote && (
            <Field
              label="Remote from"
              hint="Such as “anywhere in the US” or “Central European time”."
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={ANSWER_LIMITS.line}
                  value={answers.remoteFrom}
                  onChange={(event) => update({ remoteFrom: event.target.value })}
                />
              )}
            </Field>
          )}
          <Field
            label={local || !remote ? 'Cities' : 'Cities, if you’d go in'}
            hint="Press Enter after each one."
          >
            {(control) => (
              <TagInput
                {...control}
                value={answers.places}
                onChange={(places) => update({ places })}
                placeholder="Such as Chicago"
              />
            )}
          </Field>
          <Field label="Would you move for a job?">
            {(control) => (
              <Select
                {...control}
                value={answers.relocate}
                onChange={(event) =>
                  update({ relocate: event.target.value as AboutYou['relocate'] })
                }
              >
                {RELOCATE.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Companies</h3>
        <ChipGroup
          label="Kinds of company"
          hint={COMPANY_KINDS.map(([, label, about]) => `${label}: ${about.toLowerCase()}.`).join(
            ' ',
          )}
          options={options(COMPANY_KINDS)}
          value={answers.companies}
          onChange={(companies) => update({ companies })}
        />
        <div className={styles.fields}>
          <Field label="Industries you’d love" hint="Press Enter after each one.">
            {(control) => (
              <TagInput
                {...control}
                value={answers.industries}
                onChange={(industries) => update({ industries })}
                placeholder="Such as healthcare"
              />
            )}
          </Field>
          <Field label="Industries you won’t work in">
            {(control) => (
              <TagInput
                {...control}
                value={answers.avoid}
                onChange={(avoid) => update({ avoid })}
                placeholder="Such as gambling"
              />
            )}
          </Field>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Pay and terms</h3>
        <div className={styles.fields}>
          <Field label="Lowest base pay you’d take" hint="Such as $120,000 a year, or $60 an hour.">
            {(control) => (
              <Input
                {...control}
                maxLength={ANSWER_LIMITS.entry}
                value={answers.minPay}
                onChange={(event) => update({ minPay: event.target.value })}
              />
            )}
          </Field>
          <Field label="Pay you’re hoping for">
            {(control) => (
              <Input
                {...control}
                maxLength={ANSWER_LIMITS.entry}
                value={answers.targetPay}
                onChange={(event) => update({ targetPay: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Checkbox
          label="Leave out jobs that list less than my lowest"
          checked={answers.payFilter}
          disabled={!answers.minPay}
          onChange={(event) => update({ payFilter: event.target.checked })}
        />
        <ChipGroup
          label="Kinds of employment"
          options={options(EMPLOYMENT)}
          value={answers.employment}
          onChange={(employment) => update({ employment })}
        />
        <div className={styles.fields}>
          <Field
            label="Work authorization"
            hint="Such as “US citizen” or “needs visa sponsorship”."
          >
            {(control) => (
              <Input
                {...control}
                maxLength={ANSWER_LIMITS.line}
                value={answers.authorization}
                onChange={(event) => update({ authorization: event.target.value })}
              />
            )}
          </Field>
          <Field label="When you could start" hint="Such as “right away” or “two weeks’ notice”.">
            {(control) => (
              <Input
                {...control}
                maxLength={ANSWER_LIMITS.line}
                value={answers.start}
                onChange={(event) => update({ start: event.target.value })}
              />
            )}
          </Field>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>What makes or breaks a job</h3>
        <div className={styles.fields}>
          <Field
            label="Must-haves"
            hint="Such as a four-day week, a mission you believe in, or a team that ships."
          >
            {(control) => (
              <TextArea
                {...control}
                maxLength={ANSWER_LIMITS.text}
                value={answers.mustHaves}
                onChange={(event) => update({ mustHaves: event.target.value })}
              />
            )}
          </Field>
          <Field label="Deal-breakers" hint="Such as on-call weeks, travel, or a long commute.">
            {(control) => (
              <TextArea
                {...control}
                maxLength={ANSWER_LIMITS.text}
                value={answers.dealBreakers}
                onChange={(event) => update({ dealBreakers: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Checkbox
          label="Keep my search quiet: I’m employed, and my employer shouldn’t find out"
          checked={answers.quiet}
          onChange={(event) => update({ quiet: event.target.checked })}
        />
      </div>
    </section>
  );
}
