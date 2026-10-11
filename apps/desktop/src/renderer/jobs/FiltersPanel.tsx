import {
  Button,
  Checkbox,
  Chip,
  FIT_TIER_DISPLAY,
  Field,
  Input,
  Select,
  type Tone,
} from '@factwright/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './FiltersPanel.module.css';
import { filterCount, type ListFilter, NO_FILTERS, type TierFilter } from './rows.ts';

const TIERS: readonly { tier: TierFilter; label: string; tone: Tone }[] = [
  ...(['strong', 'good', 'worth', 'long', 'skip'] as const).map((tier) => ({
    tier,
    ...FIT_TIER_DISPLAY[tier],
  })),
  { tier: 'none', label: 'Not scored', tone: 'gray' },
];

/** The Filters button, and the panel it opens: fit, where jobs came from, pay, resumes, archived. */
export function FiltersPanel({
  filter,
  onFilter,
  sources,
}: {
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  sources: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const count = filterCount(filter);

  // A click anywhere else closes the panel, as a menu would, and so does Escape inside it.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !box.current?.contains(document.activeElement)) return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const toggleTier = (tier: TierFilter) =>
    onFilter({
      ...filter,
      tiers: filter.tiers.includes(tier)
        ? filter.tiers.filter((each) => each !== tier)
        : [...filter.tiers, tier],
    });

  return (
    <div ref={box} className={styles.box}>
      <Button
        ref={button}
        size="sm"
        className={count > 0 ? styles.active : undefined}
        icon={<SlidersHorizontal size={14} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {count > 0 ? `Filters · ${count}` : 'Filters'}
      </Button>
      {open && (
        <section id={panelId} aria-label="Filters" className={styles.panel}>
          <fieldset className={styles.tiers}>
            <legend className={styles.legend}>Fit</legend>
            <div className={styles.chips}>
              {TIERS.map(({ tier, label, tone }) => (
                <Chip
                  key={tier}
                  tone={tone}
                  pressed={filter.tiers.includes(tier)}
                  onClick={() => toggleTier(tier)}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Field label="Found through">
            {(control) => (
              <Select
                {...control}
                value={filter.source ?? ''}
                onChange={(event) => onFilter({ ...filter, source: event.target.value || null })}
              >
                <option value="">Anywhere</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Pays at least" hint="In thousands a year, such as 150 for $150k.">
            {(control) => (
              <Input
                {...control}
                className={styles.pay}
                type="number"
                min={0}
                step={5}
                inputMode="numeric"
                value={filter.minPay ? filter.minPay / 1000 : ''}
                onChange={(event) => {
                  const thousands = Number(event.target.value);
                  onFilter({ ...filter, minPay: thousands > 0 ? thousands * 1000 : null });
                }}
              />
            )}
          </Field>
          <div className={styles.checks}>
            <Checkbox
              label="Has a resume"
              checked={filter.hasResume}
              onChange={(event) => onFilter({ ...filter, hasResume: event.target.checked })}
            />
            <Checkbox
              label="Show archived jobs"
              checked={filter.showArchived}
              onChange={(event) => onFilter({ ...filter, showArchived: event.target.checked })}
            />
          </div>
          <div className={styles.foot}>
            <Button
              variant="quiet"
              size="sm"
              disabled={count === 0}
              onClick={() => onFilter({ ...filter, ...NO_FILTERS })}
            >
              Clear filters
            </Button>
            <Button variant="primary" size="sm" onClick={close}>
              Done
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
