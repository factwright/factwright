import {
  type Employer,
  HISTORY_LIMITS,
  historyDate,
  type Position,
  readHistory,
  type School,
  type WorkHistory,
} from '@factwright/core';
import { Button, Checkbox, Field, Input, TextArea } from '@factwright/ui';
import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi } from '../../../shared/api.ts';
import styles from './steps.module.css';

/** How long it waits after typing stops to save. */
const SAVE_AFTER_MS = 500;

const NEW_POSITION: Position = { title: '', start: '', end: '', summary: '' };
const NEW_EMPLOYER: Employer = { company: '', location: '', positions: [NEW_POSITION] };
const NEW_SCHOOL: School = { school: '', degree: '', field: '', start: '', end: '' };

/** Whether a date is typed the way Profile keeps one, or blank. */
const dateReads = (date: string) => date.trim() === '' || historyDate(date) === date.trim();

/** A date's box, with a hint that says how to type it, and says so when it doesn't read. */
function DateField({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const reads = dateReads(value);
  return (
    <Field
      label={label}
      hint={reads ? 'Such as 2021-03, or 2021.' : 'Type it as 2021-03, or 2021.'}
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          disabled={disabled}
          aria-invalid={!reads}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * Each job and school, for forms that ask for them one at a time: every position you held,
 * newest first, under its company, so several positions at one company stay apart, and every
 * school. Your Claude fills them in from your facts and resumes; here you change them. What you
 * type is saved as you go, and a date that doesn't read is left blank until it does.
 */
export function HistoryStep({
  history,
  api,
}: {
  history: WorkHistory;
  api: Pick<FactwrightApi, 'saveHistory'>;
}) {
  const titleId = useId();
  // What's typed, kept as typed while the dialog's open, so a date half typed stays.
  const [draft, setDraft] = useState<WorkHistory>(history);
  const waiting = useRef<WorkHistory | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What's waiting to be saved goes as the dialog closes, so nothing typed is lost.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (waiting.current) void api.saveHistory(readHistory(waiting.current));
    },
    [api],
  );

  const change = (next: WorkHistory) => {
    setDraft(next);
    waiting.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const saving = waiting.current;
      waiting.current = null;
      if (saving) void api.saveHistory(readHistory(saving));
    }, SAVE_AFTER_MS);
  };

  const setJob = (at: number, job: Employer) =>
    change({ ...draft, jobs: draft.jobs.map((each, i) => (i === at ? job : each)) });
  const setPosition = (at: number, held: number, position: Position) => {
    const job = draft.jobs[at];
    if (!job) return;
    setJob(at, {
      ...job,
      positions: job.positions.map((each, i) => (i === held ? position : each)),
    });
  };
  const setSchool = (at: number, school: School) =>
    change({ ...draft, schools: draft.schools.map((each, i) => (i === at ? school : each)) });

  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Work history and education
        </h2>
        <p className={styles.lead}>
          Each job and school, for forms that ask for them one at a time. Several positions at one
          company each go under it, newest first, with their own title and dates.
        </p>
      </div>

      {draft.jobs.map((job, at) => (
        <fieldset key={`job-${at}`} className={styles.kind}>
          <legend className={styles.legend}>{job.company || `Company ${at + 1}`}</legend>
          <div className={styles.fields}>
            <Field label="Company">
              {(control) => (
                <Input
                  {...control}
                  value={job.company}
                  maxLength={HISTORY_LIMITS.line}
                  {...(at === draft.jobs.length - 1 && !job.company && { 'data-autofocus': true })}
                  onChange={(event) => setJob(at, { ...job, company: event.target.value })}
                />
              )}
            </Field>
            <Field label="Location" hint="Such as “Denver, CO”, or “Remote”.">
              {(control) => (
                <Input
                  {...control}
                  value={job.location}
                  maxLength={HISTORY_LIMITS.line}
                  onChange={(event) => setJob(at, { ...job, location: event.target.value })}
                />
              )}
            </Field>
          </div>
          {job.positions.map((position, held) => {
            const now = position.end === 'present';
            return (
              <div key={`position-${held}`} className={styles.kind}>
                <div className={styles.fields}>
                  <Field label="Title" className={styles.wide}>
                    {(control) => (
                      <Input
                        {...control}
                        value={position.title}
                        maxLength={HISTORY_LIMITS.line}
                        onChange={(event) =>
                          setPosition(at, held, { ...position, title: event.target.value })
                        }
                      />
                    )}
                  </Field>
                  <DateField
                    label="Started"
                    value={position.start}
                    onChange={(start) => setPosition(at, held, { ...position, start })}
                  />
                  <DateField
                    label="Ended"
                    value={now ? '' : position.end}
                    disabled={now}
                    onChange={(end) => setPosition(at, held, { ...position, end })}
                  />
                </div>
                <Checkbox
                  label="I hold this position now"
                  checked={now}
                  onChange={(event) =>
                    setPosition(at, held, {
                      ...position,
                      end: event.target.checked ? 'present' : '',
                    })
                  }
                />
                <Field label="What you did" hint="A sentence or two, for a form’s box that asks.">
                  {(control) => (
                    <TextArea
                      {...control}
                      rows={2}
                      value={position.summary}
                      maxLength={HISTORY_LIMITS.summary}
                      onChange={(event) =>
                        setPosition(at, held, { ...position, summary: event.target.value })
                      }
                    />
                  )}
                </Field>
                {job.positions.length > 1 && (
                  <div>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        setJob(at, {
                          ...job,
                          positions: job.positions.filter((_, i) => i !== held),
                        })
                      }
                    >
                      Remove {position.title ? `“${position.title}”` : 'this position'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          <div className={styles.row}>
            <Button
              size="sm"
              icon={<Plus size={14} aria-hidden="true" />}
              disabled={job.positions.length >= HISTORY_LIMITS.positions}
              onClick={() => setJob(at, { ...job, positions: [...job.positions, NEW_POSITION] })}
            >
              Add a position {job.company ? `at ${job.company}` : 'here'}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => change({ ...draft, jobs: draft.jobs.filter((_, i) => i !== at) })}
            >
              Remove {job.company || 'this company'}
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={draft.jobs.length >= HISTORY_LIMITS.jobs}
          onClick={() => change({ ...draft, jobs: [...draft.jobs, NEW_EMPLOYER] })}
        >
          Add a company
        </Button>
      </div>

      <h3 className={styles.sectionTitle}>Education</h3>
      {draft.schools.map((school, at) => (
        <fieldset key={`school-${at}`} className={styles.kind}>
          <legend className={styles.legend}>{school.school || `School ${at + 1}`}</legend>
          <div className={styles.fields}>
            <Field label="School" className={styles.wide}>
              {(control) => (
                <Input
                  {...control}
                  value={school.school}
                  maxLength={HISTORY_LIMITS.line}
                  onChange={(event) => setSchool(at, { ...school, school: event.target.value })}
                />
              )}
            </Field>
            <Field label="Degree" hint="Such as “B.S.” or “MBA”.">
              {(control) => (
                <Input
                  {...control}
                  value={school.degree}
                  maxLength={HISTORY_LIMITS.line}
                  onChange={(event) => setSchool(at, { ...school, degree: event.target.value })}
                />
              )}
            </Field>
            <Field label="Field of study">
              {(control) => (
                <Input
                  {...control}
                  value={school.field}
                  maxLength={HISTORY_LIMITS.line}
                  onChange={(event) => setSchool(at, { ...school, field: event.target.value })}
                />
              )}
            </Field>
            <DateField
              label="Started"
              value={school.start}
              onChange={(start) => setSchool(at, { ...school, start })}
            />
            <DateField
              label="Finished"
              value={school.end}
              onChange={(end) => setSchool(at, { ...school, end })}
            />
          </div>
          <div>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                change({ ...draft, schools: draft.schools.filter((_, i) => i !== at) })
              }
            >
              Remove {school.school || 'this school'}
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={draft.schools.length >= HISTORY_LIMITS.schools}
          onClick={() => change({ ...draft, schools: [...draft.schools, NEW_SCHOOL] })}
        >
          Add a school
        </Button>
      </div>
    </section>
  );
}
