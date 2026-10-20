import {
  FOCUS_LIMITS,
  FOCUS_POSTED,
  FOCUS_STAGES,
  FOCUS_WORKPLACES,
  type FocusPosted,
  focusName,
  isFocused,
  payAmount,
  type SearchFocus,
} from '@factwright/core';
import { ChipGroup, Field, Input, Select, TagInput, TextArea } from '@factwright/ui';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import styles from './SearchFocus.module.css';

/** A dollar amount as the box shows it: "150,000". */
const shown = (dollars: number | null) => (dollars === null ? '' : dollars.toLocaleString('en-US'));

/**
 * What one search looks for, on top of what the user wants in Profile: the kinds of company, a
 * pay range, where it's worked, industries to look in or leave out, how recently it was posted,
 * and anything else. It's folded until opened, and says what it's set to while folded.
 */
export function FocusSection({
  focus,
  onChange,
  place,
}: {
  focus: SearchFocus;
  /** Called with the focus as it is now, and whether it can be searched: its pay reads. */
  onChange: (focus: SearchFocus, ok: boolean) => void;
  /** How Found by will name the search's place, such as "LinkedIn Oct 20". */
  place: string;
}) {
  const [open, setOpen] = useState(false);
  // What's typed for pay, kept as typed until it reads as an amount.
  const [pay, setPay] = useState({ min: shown(focus.payMin), max: shown(focus.payMax) });
  // Pay that's typed reads as a yearly amount, with the lower one first.
  const payOk = (typed: typeof pay, next: SearchFocus) =>
    !(
      (typed.min.trim() !== '' && next.payMin === null) ||
      (typed.max.trim() !== '' && next.payMax === null) ||
      (next.payMin !== null && next.payMax !== null && next.payMin > next.payMax)
    );
  const set = (changes: Partial<SearchFocus>, typed = pay) => {
    const next = { ...focus, ...changes };
    onChange(next, payOk(typed, next));
  };
  const name = focusName(focus);
  const badPay = !payOk(pay, focus);
  return (
    <div className={`${styles.focus} ${open ? styles.open : ''}`}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={styles.chevron} size={15} aria-hidden="true" />
        <span className={styles.title}>Focus this search</span>
        <span className={styles.summary}>{name || (isFocused(focus) ? 'Set' : 'Optional')}</span>
      </button>
      {open && (
        <div className={styles.body}>
          <p className={styles.hint}>
            For this search only, on top of what you want in Profile, which stays as it is. Your
            deal-breakers still apply.
          </p>
          <ChipGroup
            label="Kind of company"
            options={FOCUS_STAGES.map(([value, label]) => ({ value, label }))}
            value={focus.stages}
            onChange={(stages) => set({ stages })}
            hint={
              focus.stages.length === 1
                ? FOCUS_STAGES.find(([id]) => id === focus.stages[0])?.[2]
                : undefined
            }
          />
          <div className={styles.pay}>
            <Field label="Pay a year, from">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  placeholder="150,000"
                  value={pay.min}
                  maxLength={20}
                  aria-invalid={badPay}
                  onChange={(event) => {
                    const typed = { ...pay, min: event.target.value };
                    setPay(typed);
                    set({ payMin: payAmount(typed.min) }, typed);
                  }}
                />
              )}
            </Field>
            <Field label="to">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  placeholder="200,000"
                  value={pay.max}
                  maxLength={20}
                  aria-invalid={badPay}
                  onChange={(event) => {
                    const typed = { ...pay, max: event.target.value };
                    setPay(typed);
                    set({ payMax: payAmount(typed.max) }, typed);
                  }}
                />
              )}
            </Field>
          </div>
          {badPay && (
            <p className={styles.problem} role="alert">
              Type pay as a yearly amount, such as 150,000 or 150k, with the lower one first.
            </p>
          )}
          <ChipGroup
            label="Where"
            options={FOCUS_WORKPLACES.map(([value, label]) => ({ value, label }))}
            value={focus.workplaces}
            onChange={(workplaces) => set({ workplaces })}
          />
          <div className={styles.industries}>
            <Field label="Only these industries">
              {(control) => (
                <TagInput
                  {...control}
                  value={focus.industries}
                  placeholder="Such as healthcare, climate"
                  max={FOCUS_LIMITS.industries}
                  maxLength={FOCUS_LIMITS.industry}
                  onChange={(industries) => set({ industries })}
                />
              )}
            </Field>
            <Field label="Leave out">
              {(control) => (
                <TagInput
                  {...control}
                  value={focus.avoid}
                  placeholder="Such as crypto, gambling"
                  max={FOCUS_LIMITS.industries}
                  maxLength={FOCUS_LIMITS.industry}
                  onChange={(avoid) => set({ avoid })}
                />
              )}
            </Field>
          </div>
          <Field label="Posted">
            {(control) => (
              <Select
                {...control}
                className={styles.posted}
                value={String(focus.posted)}
                onChange={(event) => set({ posted: Number(event.target.value) as FocusPosted })}
              >
                {FOCUS_POSTED.map(([days, label]) => (
                  <option key={days} value={days}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Anything else for this search"
            hint="Your Claude reads it as yours, for this search alone."
          >
            {(control) => (
              <TextArea
                {...control}
                rows={2}
                maxLength={FOCUS_LIMITS.notes}
                placeholder="Such as: teams that ship every week, and no on-call."
                value={focus.notes}
                onChange={(event) => set({ notes: event.target.value })}
              />
            )}
          </Field>
          {name && (
            <p className={styles.hint}>
              Found by names it <span className={styles.label}>{`${place} · ${name}`}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
