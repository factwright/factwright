import {
  Button,
  Checkbox,
  ChipGroup,
  Field,
  Input,
  Select,
  TagInput,
  TextArea,
} from '@factwright/ui';
import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  COMPANY_KINDS,
  EMPLOYMENT,
  FIELDS,
  type JobKind,
  type KindAnswers,
  LEVELS,
  RELOCATE,
  WORKPLACES,
} from '../../../shared/about.ts';
import { changeKind, hasKinds, kindsOf, removeKind } from '../../../shared/kinds.ts';
import { AddKind, KindNameField, KindSwitcher, RemoveKind } from './KindsOfJob.tsx';
import styles from './steps.module.css';

const options = <T extends string>(list: readonly (readonly [T, string, ...string[]])[]) =>
  list.map(([value, label]) => ({ value, label }));

/** The lowest and hoped-for pay, for one kind of job or the only one. */
function PayFields({
  kind,
  change,
}: {
  kind: KindAnswers;
  change: (changes: Partial<KindAnswers>) => void;
}) {
  return (
    <>
      <div className={styles.fields}>
        <Field label="Lowest base pay you’d take" hint="Such as $120,000 a year, or $60 an hour.">
          {(control) => (
            <Input
              {...control}
              maxLength={ANSWER_LIMITS.entry}
              value={kind.minPay}
              onChange={(event) => change({ minPay: event.target.value })}
            />
          )}
        </Field>
        <Field label="Pay you’re hoping for">
          {(control) => (
            <Input
              {...control}
              maxLength={ANSWER_LIMITS.entry}
              value={kind.targetPay}
              onChange={(event) => change({ targetPay: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Checkbox
        label="Leave out jobs that list less than my lowest"
        checked={kind.payFilter}
        disabled={!kind.minPay}
        onChange={(event) => change({ payFilter: event.target.checked })}
      />
    </>
  );
}

/**
 * What the user is looking for, as fully as they'll say: the work, the level, where, the kinds of
 * company and industry, pay and terms, and what makes or breaks a job. Job searches and fit
 * checks go by it, and the resumes aim at it. Someone after more than one kind of job, such as
 * developer and project manager jobs, gives each kind its own titles, work, levels and pay, and
 * the rest holds for all of them.
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
  const kinds = kindsOf(answers);
  const many = hasKinds(answers);
  const [picked, setPicked] = useState(kinds[0]?.id ?? '');
  const [adding, setAdding] = useState(false);
  // A kind just added, whose titles are the next thing to fill in.
  const [added, setAdded] = useState<string | null>(null);
  // Where focus goes once the button the user pressed has gone: back to adding a kind after
  // Cancel, or to the kind now picked after removing one.
  const work = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState<'add' | 'kinds' | null>(null);
  useEffect(() => {
    if (!refocus) return;
    setRefocus(null);
    const picked = refocus === 'kinds' ? 'input[type="radio"]:checked, ' : '';
    work.current?.querySelector<HTMLElement>(`${picked}[data-add-kind]`)?.focus();
  }, [refocus]);
  const kind = (kinds.find((each) => each.id === picked) ?? kinds[0]) as JobKind;
  const first = kinds[0] as JobKind;
  const change = (changes: Partial<KindAnswers>) => update(changeKind(answers, kind.id, changes));
  const addForm = adding && (
    <AddKind
      answers={answers}
      onAdd={(changes, id) => {
        update(changes);
        setPicked(id);
        setAdded(id);
        setAdding(false);
      }}
      onCancel={() => {
        setAdding(false);
        setRefocus('add');
      }}
    />
  );
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

      <div ref={work} className={styles.section}>
        <h3 className={styles.sectionTitle}>The work</h3>
        {many && (
          <KindSwitcher
            answers={answers}
            value={kind.id}
            onChange={(id) => {
              setPicked(id);
              setAdded(null);
              setAdding(false);
            }}
            onAdd={() => setAdding(true)}
          />
        )}
        {many && addForm}
        {/* Each kind's panel is its own, so its name and its question about removing it start afresh. */}
        <div key={kind.id} className={many ? styles.kind : styles.section}>
          {many && (
            <KindNameField answers={answers} id={kind.id} name={kind.name} update={update} />
          )}
          <Field
            label="Job titles you want"
            hint="Press Enter after each one. Close matches count too."
          >
            {(control) => (
              <TagInput
                {...control}
                autoFocus={added === kind.id}
                value={kind.roles}
                onChange={(roles) => change({ roles })}
                placeholder="Such as Product Designer"
              />
            )}
          </Field>
          <ChipGroup
            label="Kinds of work"
            options={options(FIELDS)}
            value={kind.fields}
            onChange={(fields) => change({ fields })}
          />
          <ChipGroup
            label="Levels"
            hint="Pick every level you’d take."
            options={options(LEVELS)}
            value={kind.levels}
            onChange={(levels) => change({ levels })}
          />
          {many && <PayFields kind={kind} change={change} />}
          {many && kind.id !== first.id && (
            <RemoveKind
              name={kind.name}
              firstName={first.name}
              onRemove={() => {
                update(removeKind(answers, kind.id));
                setPicked(first.id);
                setRefocus('kinds');
              }}
            />
          )}
        </div>
        {/* With one kind, adding another names the jobs above it, so it comes after them. */}
        {!many &&
          (addForm || (
            <div>
              <Button
                size="sm"
                variant="quiet"
                icon={<Plus size={14} aria-hidden="true" />}
                data-add-kind
                onClick={() => setAdding(true)}
              >
                Add another kind of job
              </Button>
            </div>
          ))}
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
        {/* With more than one kind of job, each kind's pay is with its work above. */}
        <h3 className={styles.sectionTitle}>{many ? 'Terms' : 'Pay and terms'}</h3>
        {!many && <PayFields kind={answers} change={update} />}
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
