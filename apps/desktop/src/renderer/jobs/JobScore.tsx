import {
  type FitReport,
  type Job,
  type ListItem,
  SCORE_PARTS,
  type ScorePart,
  type ScorePartKey,
  shortDate,
} from '@factwright/core';
import { MarkdownLine, MoodBadge, ScoreBar } from '@factwright/ui';
import { Check, Minus, X } from 'lucide-react';
import styles from './JobPanel.module.css';

const PART_LABELS: Readonly<Record<ScorePartKey, string>> = {
  work: 'Work',
  role: 'Role',
  stack: 'Stack',
  reqs: 'Requirements',
};

/** The most each part can score, as fit checks and job searches use them. */
const PART_MAX: Readonly<Record<ScorePartKey, number>> = {
  work: 40,
  role: 25,
  stack: 20,
  reqs: 15,
};

const MARKS = {
  yes: { label: 'Proven', icon: Check, className: styles.proven },
  part: { label: 'Partly', icon: Minus, className: styles.partly },
  no: { label: 'Missing', icon: X, className: styles.missing },
} as const;

/** What the job's score is made of: the fit check's write-up, or else the job search's notes. */
interface ScoreModel {
  from: 'fit check' | 'job search';
  date: string | null;
  total: number | null;
  parts: ScorePart[] | null;
  filters: FitReport['filters'];
  why: ListItem[];
  gaps: ListItem[];
  flags: ListItem[];
}

const items = (texts: readonly string[]): ListItem[] => texts.map((text) => ({ text, sub: [] }));

function scoreModel(job: Job): ScoreModel | null {
  const { search, fitReport: report } = job;
  const parts = search
    ? SCORE_PARTS.flatMap((key) => {
        const points = search.detail.parts[key];
        if (points === undefined) return [];
        return [
          { key, points, max: PART_MAX[key], why: search.detail.partsWhy[key] ?? null, items: [] },
        ];
      })
    : [];
  const fromSearch: ScoreModel | null =
    search && parts.length > 0
      ? {
          from: 'job search',
          date: search.date,
          total: search.score,
          parts,
          filters: null,
          why: items(search.detail.why),
          gaps: items(search.detail.gaps),
          flags: items(search.detail.flags),
        }
      : null;
  if (!job.fit && report?.total == null) return fromSearch;
  return {
    from: 'fit check',
    date: report?.date ?? job.fit?.date ?? null,
    total: report?.total ?? job.fit?.score ?? null,
    parts: report?.parts ?? null,
    filters: report?.filters ?? null,
    why: report?.why ?? [],
    gaps: report?.gaps ?? [],
    flags: report?.flags ?? [],
  };
}

/** A list from a write-up, with the items under each. */
function ItemList({ list }: { list: readonly ListItem[] }) {
  return (
    <ul className={styles.items}>
      {list.map((item, i) => (
        <li key={`${i}.${item.text}`}>
          <MarkdownLine text={item.text} />
          {item.sub.length > 0 && (
            <ul>
              {item.sub.map((sub, k) => (
                <li key={`${k}.${sub}`}>
                  <MarkdownLine text={sub} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "✓ Patient scheduling: portal v1, live": the job's work, then the fact that proves it. */
function Evidence({ part }: { part: ScorePart }) {
  return (
    <ul className={styles.evidence}>
      {part.items.map((item, i) => {
        const mark = item.mark ? MARKS[item.mark] : null;
        const split = !item.text.startsWith('**') && item.text.match(/^([^:()]{2,60}):\s+(.+)$/);
        const text = split ? `**${split[1]}:** ${split[2]}` : item.text;
        return (
          <li key={`${i}.${item.text}`}>
            {mark ? (
              <mark.icon
                className={mark.className}
                size={14}
                strokeWidth={2.6}
                role="img"
                aria-label={mark.label}
              />
            ) : (
              <span className={styles.noMark} aria-hidden="true" />
            )}
            <span>
              <MarkdownLine text={text} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Why the job scored what it did, part by part, with the evidence behind the work. */
export function ScoreSection({ job, today }: { job: Job; today: string }) {
  const model = scoreModel(job);
  if (!model) {
    return (
      <section className={styles.part}>
        <h4 className={styles.subheading}>Not scored yet</h4>
        <p className={styles.quiet}>
          A fit check scores this job against your fact bank, and looks up what people say about the
          company. Ask your Claude to run one.
        </p>
      </section>
    );
  }
  const lists = (
    [
      ['Why it fits', model.why],
      ['Gaps', model.gaps],
      ['Watch for', model.flags],
    ] as const
  ).filter(([, list]) => list.length > 0);
  const failed = model.filters && !model.filters.pass;
  return (
    <section className={styles.part}>
      <div className={styles.sectionHead}>
        <h4 className={styles.subheading}>
          {model.total !== null ? `Why it scored ${model.total}` : 'Score'}
        </h4>
        <span className={styles.meta}>
          From the {model.from}
          {model.date && ` · ${shortDate(model.date, today)}`}
        </span>
      </div>
      {failed && model.filters && (
        <p className={styles.failed}>
          <strong>Didn’t pass your filters.</strong>{' '}
          <MarkdownLine text={model.filters.text.replace(/^fail\b[.:]?\s*/i, '')} />
        </p>
      )}
      {model.parts ? (
        <div className={styles.parts}>
          {model.parts.map((part) => (
            <ScoreBar
              key={part.key}
              label={PART_LABELS[part.key]}
              points={part.points}
              max={part.max}
            >
              {part.why && <MarkdownLine text={part.why} />}
              {part.items.length > 0 && <Evidence part={part} />}
            </ScoreBar>
          ))}
        </div>
      ) : (
        <p className={styles.quiet}>
          This fit check saved only its total. Run it again to see the breakdown.
        </p>
      )}
      {lists.length > 0 && (
        <details className={styles.more}>
          <summary>{lists.map(([title, list]) => `${title} (${list.length})`).join(' · ')}</summary>
          {lists.map(([title, list]) => (
            <div key={title} className={styles.moreGroup}>
              <h5 className={styles.listHeading}>{title}</h5>
              <ItemList list={list} />
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/** What people say about working at the company, from the fit check. */
export function SentimentSection({ job, today }: { job: Job; today: string }) {
  const sentiment = job.sentiment;
  if (!sentiment) return null;
  const { mood, summary, points, date } = sentiment;
  return (
    <section className={styles.part}>
      <div className={styles.sectionHead}>
        <h4 className={styles.subheading}>What people say</h4>
        <span className={styles.meta}>
          From the {sentiment.from === 'job-notes' ? 'job notes' : 'fit check'}
          {date && ` · ${shortDate(date, today)}`}
        </span>
      </div>
      {(mood || summary) && (
        <p className={styles.mood}>
          {mood && <MoodBadge mood={mood} />}
          {summary && (
            <span>
              <MarkdownLine text={summary} />
            </span>
          )}
        </p>
      )}
      {points.length > 0 &&
        (summary ? (
          <details className={styles.more}>
            <summary>Reviews, talk and news ({points.length})</summary>
            <ItemList list={points} />
          </details>
        ) : (
          <ItemList list={points} />
        ))}
    </section>
  );
}

/** What the job search noted, beyond the score. */
export function SearchSection({ job, today }: { job: Job; today: string }) {
  const search = job.search;
  if (!search) return null;
  const { pick, what, stage, note, apply, report } = search.detail;
  const facts = (
    [
      ['Why it stood out', pick],
      ['What they do', what],
      ['Company stage', stage],
      ['Note', note],
      ['How to apply', apply],
    ] as const
  ).flatMap(([label, value]) => (value ? [{ label, value }] : []));
  if (facts.length === 0 && !report) return null;
  return (
    <section className={styles.part}>
      <div className={styles.sectionHead}>
        <h4 className={styles.subheading}>From the job search</h4>
        <span className={styles.meta}>
          {search.source}
          {search.date && ` · ${shortDate(search.date, today)}`}
        </span>
      </div>
      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <MarkdownLine text={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {report && (
        <a className={styles.link} href={report} target="_blank" rel="noreferrer">
          Open the search report
        </a>
      )}
    </section>
  );
}
