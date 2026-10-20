import { isFocused, type KindName, NO_FOCUS, type SearchFocus } from '@factwright/core';
import { Button, Dialog, DialogActions, Input, SegmentedControl, Select } from '@factwright/ui';
import { type FormEvent, useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import {
  COMMAND_LINE_MARKS,
  SEARCH_SITES,
  type SearchSite,
  type SearchSources,
  searchCompany,
} from '../../shared/runs.ts';
import { usePref } from '../prefs.ts';
import styles from './FindJobsDialog.module.css';
import { FocusSection } from './SearchFocus.tsx';

/** Each place to look, as the dialog offers it. */
const PLACES: Readonly<Record<SearchSite, { name: string; about: string }>> = {
  hn: {
    name: 'Hacker News: Who is hiring?',
    about: 'The monthly thread where hundreds of startups post. Your Claude reads all of it.',
  },
  linkedin: {
    name: 'LinkedIn',
    about:
      'Postings found through a web search, each read on the employer’s own site. Factwright never opens LinkedIn or signs in.',
  },
  indeed: {
    name: 'Indeed',
    about: 'Listings found through a web search, each read on the employer’s own site.',
  },
  boards: {
    name: 'Company job boards',
    about: 'Openings on Greenhouse, Lever, Ashby and Gem, straight from the companies hiring.',
  },
};

const MONTH_NAME = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** How Found by names a search of a place, as the job search names it: "LinkedIn Oct 20". */
function placeName(site: SearchSite | undefined, month: string, today: string): string {
  const day = MONTH_DAY.format(new Date(`${today}T12:00:00Z`));
  if (site === 'hn') {
    const thread = month || today.slice(0, 7);
    return `HN ${MONTH_NAME.format(new Date(`${thread}-01T12:00:00Z`))}`;
  }
  const names: Record<Exclude<SearchSite, 'hn'>, string> = {
    linkedin: 'LinkedIn',
    indeed: 'Indeed',
    boards: 'Company job boards',
  };
  return `${site ? names[site] : 'Company'} ${day}`;
}

/** This month's thread and the three before, by YYYY-MM, newest first. */
function recentMonths(today: string): { value: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return [0, 1, 2, 3].map((back) => {
    const date = new Date(Date.UTC(year, month - back, 1));
    return { value: date.toISOString().slice(0, 7), label: MONTH_NAME.format(date) };
  });
}

const isSites = (value: unknown): value is SearchSite[] =>
  Array.isArray(value) &&
  value.every((site) => (SEARCH_SITES as readonly unknown[]).includes(site));

const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * Where to look for jobs: HN's monthly thread, LinkedIn, Indeed, companies' job boards, and a
 * company the user has in mind. Each place is a search of its own, so its jobs can be seen
 * together later. With more than one kind of job, it looks for one kind or every kind. The
 * places and the kind picked are kept for next time. A focus is for this search alone, so it
 * starts empty each time: the app keeps it for the search to read, and the search names it.
 */
export function FindJobsDialog({
  api,
  today,
  kinds = [],
  onStart,
  onClose,
}: {
  api: Pick<FactwrightApi, 'saveSearchFocus'>;
  today: string;
  /** The user's kinds of job, when they want more than one. */
  kinds?: readonly KindName[];
  onStart: (sources: SearchSources) => void;
  onClose: () => void;
}) {
  const [sites, setSites] = usePref<SearchSite[]>('search.sites', ['hn'], isSites);
  const [kept, setKind] = usePref<string>('search.kind', '', isText);
  // A kind since removed, or none at all, looks for every kind.
  const kind = kinds.length > 1 && kinds.some((each) => each.id === kept) ? kept : '';
  const [month, setMonth] = useState('');
  const [naming, setNaming] = useState(false);
  const [company, setCompany] = useState('');
  const [focus, setFocus] = useState<SearchFocus>(NO_FOCUS);
  // Whether the focus can be searched: its pay reads.
  const [focusOk, setFocusOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const companyId = useId();
  const hintId = useId();
  const named = naming ? searchCompany(company) : null;
  const badCompany = naming && company.trim() !== '' && named === null;
  const count = sites.length + (named ? 1 : 0);
  const ready = count > 0 && !(naming && !named) && focusOk;

  const toggle = (site: SearchSite, on: boolean) =>
    setSites(SEARCH_SITES.filter((each) => (each === site ? on : sites.includes(each))));

  const start = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (!ready || saving) return;
    let focused: string | undefined;
    if (isFocused(focus)) {
      setSaving(true);
      const saved = await api.saveSearchFocus(focus);
      setSaving(false);
      if (!saved.ok) {
        setProblem(saved.message);
        return;
      }
      focused = saved.id;
    }
    onStart({
      sites,
      ...(month && sites.includes('hn') && { month }),
      ...(named && { company: named }),
      ...(kind && { kind }),
      ...(focused && { focus: focused }),
    });
    close();
  };

  return (
    <Dialog
      title="Find jobs"
      description="Pick where your Claude looks. It checks each job against what you want and your fact bank, and the ones that fit land in New."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => void start(event, close)}>
          {kinds.length > 1 && (
            <div className={styles.kinds}>
              <span className={styles.kindsLabel} aria-hidden="true">
                Look for
              </span>
              <SegmentedControl
                label="Look for"
                options={[
                  { value: '', label: 'Every kind' },
                  ...kinds.map(({ id, name }) => ({ value: id, label: name })),
                ]}
                value={kind}
                onChange={setKind}
              />
            </div>
          )}
          <fieldset className={styles.places}>
            <legend className={styles.legend}>Where to look</legend>
            {SEARCH_SITES.map((site) => {
              const picked = sites.includes(site);
              const { name, about } = PLACES[site];
              return (
                <div key={site} className={`${styles.place} ${picked ? styles.picked : ''}`}>
                  <label className={styles.pick}>
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={(event) => toggle(site, event.target.checked)}
                    />
                    <span className={styles.text}>
                      <span className={styles.name}>{name}</span>
                      <span className={styles.about}>{about}</span>
                    </span>
                  </label>
                  {site === 'hn' && picked && (
                    <Select
                      className={styles.month}
                      aria-label="Which month’s thread"
                      value={month}
                      onChange={(event) => setMonth(event.target.value)}
                    >
                      <option value="">The newest thread</option>
                      {recentMonths(today).map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              );
            })}
            <div className={`${styles.place} ${naming ? styles.picked : ''}`}>
              <label className={styles.pick}>
                <input
                  type="checkbox"
                  checked={naming}
                  onChange={(event) => setNaming(event.target.checked)}
                />
                <span className={styles.text}>
                  <span className={styles.name}>A company you have in mind</span>
                  <span className={styles.about}>
                    What it’s hiring for, from its own jobs page.
                  </span>
                </span>
              </label>
              {naming && (
                <div className={styles.extra}>
                  <label htmlFor={companyId} className={styles.legend}>
                    The company
                  </label>
                  <Input
                    id={companyId}
                    autoFocus
                    value={company}
                    maxLength={500}
                    placeholder="Its name, or a link to its jobs page"
                    aria-describedby={hintId}
                    aria-invalid={badCompany}
                    onChange={(event) => setCompany(event.target.value)}
                  />
                  <p id={hintId} className={badCompany ? styles.problem : styles.hint}>
                    {!badCompany
                      ? 'Such as Acme Robotics, or https://jobs.lever.co/acme.'
                      : /^https:/i.test(company.trim()) && COMMAND_LINE_MARKS.test(company)
                        ? 'A link with % or ! in it can’t be passed on. Type the company’s name instead.'
                        : 'Type a company’s name, or a link that starts with https://.'}
                  </p>
                </div>
              )}
            </div>
          </fieldset>
          <FocusSection
            focus={focus}
            onChange={(next, ok) => {
              setFocus(next);
              setFocusOk(ok);
              setProblem(null);
            }}
            place={placeName(sites[0], month, today)}
          />
          <p className={styles.hint}>
            Each place is a search of its own, so you can see its jobs together later, under Found
            by. The more places, the longer it takes.
          </p>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!ready || saving}>
              {count > 1 ? `Search ${count} places` : 'Search'}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
