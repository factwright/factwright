import { Button } from '@factwright/ui';
import { Check } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import {
  type AboutYou,
  COMPANY_KINDS,
  FIELDS,
  LEVELS,
  labelOf,
  wordCount,
} from '../../../shared/about.ts';
import { livePicks, templateName } from '../../../shared/looks.ts';
import type { TemplateInfo } from '../../../shared/profile.ts';
import ready from './ReadyStep.module.css';
import styles from './steps.module.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What the user shared, in a few words, such as "2 resumes, your LinkedIn data and a screenshot". */
export function sharedSummary(answers: Pick<AboutYou, 'files'>): string | null {
  const count = (kinds: string[]) =>
    answers.files.filter((file) => kinds.includes(file.kind)).length;
  const parts = [
    count(['resume']) ? plural(count(['resume']), 'resume') : null,
    count(['linkedin-profile']) ? 'your LinkedIn profile' : null,
    count(['linkedin-data']) ? 'your LinkedIn data' : null,
    count(['screenshot']) ? plural(count(['screenshot']), 'screenshot') : null,
    count(['document']) ? plural(count(['document']), 'other file') : null,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.length === 1
    ? (parts[0] as string)
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "a, b or c". */
const either = (words: readonly string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;

/**
 * What the user is looking for, in a line, such as "Product Designer roles (senior or lead),
 * remote from the US, at startups".
 */
export function wantsSummary(answers: AboutYou): string | null {
  const levels = either(answers.levels.map((level) => labelOf(LEVELS, level).toLowerCase()));
  const kinds = either(
    answers.fields
      .filter((field) => field !== 'other')
      .map((field) => labelOf(FIELDS, field).toLowerCase()),
  );
  const work = either(answers.roles.slice(0, 3)) || kinds;
  const what = work
    ? `${work} roles${levels ? ` (${levels})` : ''}`
    : levels
      ? `${levels.charAt(0).toUpperCase()}${levels.slice(1)} roles`
      : '';
  const where = answers.workplaces.includes('remote')
    ? `remote${answers.remoteFrom ? ` from ${answers.remoteFrom}` : ''}`
    : either(answers.places.slice(0, 2));
  const companies = either(
    answers.companies.map((kind) => labelOf(COMPANY_KINDS, kind).toLowerCase()),
  );
  const parts = [what, where, companies ? `at ${companies}` : ''].filter(Boolean);
  if (parts.length === 0) return null;
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The templates picked, in a line, such as "Minimal for startups, Classic for established companies". */
export function looksSummary(
  answers: Pick<AboutYou, 'looks'>,
  templates: readonly TemplateInfo[],
): string | null {
  const looks = livePicks(answers.looks, templates);
  if (looks.length === 0) return null;
  return looks
    .map(
      (look) =>
        `${templateName(look.layout, templates)}${look.for === 'any' ? '' : ` for ${labelOf(COMPANY_KINDS, look.for).toLowerCase()}`}`,
    )
    .join(', ');
}

/**
 * The last step: what the user shared, what happens when Claude starts, and the button that
 * starts it. Claude reads, drafts the fact bank, interviews the user to confirm it, then builds
 * the starting resumes.
 */
export function ReadyStep({
  answers,
  templates,
  notes,
  canStart,
  why,
  onStart,
  onEdit,
  claude,
}: {
  answers: AboutYou;
  templates: readonly TemplateInfo[];
  notes: string;
  canStart: boolean;
  /** Why Claude can't start yet, when it can't. */
  why: string | null;
  onStart: () => void;
  /** Goes back to a step, to change what it holds. */
  onEdit: (step: number) => void;
  /** The Claude setup help, when Claude Code isn't ready. */
  claude: ReactNode;
}) {
  const titleId = useId();
  const words = wordCount(notes);
  const rows: [string, string | null, number][] = [
    ['About you', answers.you.name || null, 1],
    ['What you shared', sharedSummary(answers), 2],
    ['In your words', words > 0 ? `${words.toLocaleString()} words about yourself` : null, 3],
    ['What you want', wantsSummary(answers), 4],
    ['Templates', looksSummary(answers, templates), 5],
  ];
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Ready for your Claude
        </h2>
        <p className={styles.lead}>Here’s what Claude will start from.</p>
      </div>

      <ul className={ready.summary}>
        {rows.map(([label, value, step]) => (
          <li key={label} className={ready.row}>
            <span className={value ? ready.done : ready.empty} aria-hidden="true">
              {value && <Check size={12} strokeWidth={2.8} />}
            </span>
            <span className={ready.label}>{label}</span>
            <span className={ready.value}>{value ?? 'Nothing yet'}</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => onEdit(step)}
              aria-label={`Change ${label.toLowerCase()}`}
            >
              Change
            </Button>
          </li>
        ))}
      </ul>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>What happens next</h3>
        <ol className={ready.next}>
          <li>
            <strong>Claude reads everything and drafts your fact bank:</strong> each job, project,
            skill and number it finds, marked to check. It takes a few minutes.
          </li>
          <li>
            <strong>It interviews you to confirm it,</strong> a few questions at a time in the panel
            below, and asks about anything it couldn’t tell. About 15 minutes. You can stop and pick
            up later.
          </li>
          <li>
            <strong>It builds a starting resume in each template you picked,</strong> and
            fact-checks every line against what you confirmed.
          </li>
        </ol>
        <p className={styles.note}>It runs on your Claude plan, like any Claude Code session.</p>
      </div>

      {claude}

      <div className={ready.start}>
        <Button variant="primary" disabled={!canStart} onClick={onStart}>
          Start with your Claude
        </Button>
        {why && <p className={styles.note}>{why}</p>}
      </div>
    </section>
  );
}
