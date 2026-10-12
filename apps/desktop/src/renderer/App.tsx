import { JOB_VIEWS, type JobView, viewOf } from '@factwright/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  FACTS_SKILL,
  GET_STARTED_SKILL,
  SEARCH_SKILL,
  TEMPLATE_SKILL,
  taskJob,
} from '../shared/runs.ts';
import styles from './App.module.css';
import { GetStarted } from './about/GetStarted.tsx';
import { ProfilePage } from './about/ProfilePage.tsx';
import { needsGettingStarted, useProfile } from './about/useProfile.ts';
import { ClaudePanel } from './ClaudePanel.tsx';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog.tsx';
import { AddJobDialog } from './jobs/AddJobDialog.tsx';
import { FindJobsDialog } from './jobs/FindJobsDialog.tsx';
import { JobPanel } from './jobs/JobPanel.tsx';
import { JobsPage } from './jobs/JobsPage.tsx';
import { JourneyDialog } from './jobs/JourneyDialog.tsx';
import { BUSY, RUN_ACTIONS, type RunControls } from './jobs/RunActions.tsx';
import {
  jobRows,
  type ListFilter,
  NO_FILTERS,
  startingView,
  stepFrom,
  visibleRows,
} from './jobs/rows.ts';
import { useJobs } from './jobs/useJobs.ts';
import { useToday } from './jobs/useToday.ts';
import { isRunning } from './PanelHeader.tsx';
import { planName } from './plan.ts';
import { isBoolean, readPref, usePref, writePref } from './prefs.ts';
import { type Page, Sidebar } from './Sidebar.tsx';
import { SyncDialog } from './sync/SyncDialog.tsx';
import { useSync } from './sync/useSync.ts';
import { TopBar } from './TopBar.tsx';
import { useClaudeRun } from './useClaudeRun.ts';
import { useClaudeStatus } from './useClaudeStatus.ts';
import { useSetupCheck } from './useSetupCheck.ts';

const isView = (value: unknown): value is JobView =>
  (JOB_VIEWS as readonly unknown[]).includes(value);

/** The app's window: the top bar, the sidebar, the jobs and their details, and Claude's panel. */
export function App({ api }: { api: FactwrightApi }) {
  const { status, recheck } = useClaudeStatus(api);
  const setup = useSetupCheck(api);
  const sync = useSync(api);
  const run = useClaudeRun(api);
  const { jobs, reload } = useJobs(api);
  const about = useProfile(api);
  const today = useToday();
  const rows = useMemo(
    () => (jobs.state === 'ready' ? jobRows(jobs.list.jobs, today) : []),
    [jobs, today],
  );
  // The view the user last picked, or, the first time, one chosen once the jobs load.
  const [filter, setFilter] = useState<ListFilter>(() => ({
    view: readPref<JobView>('jobs.view', 'review', isView),
    query: '',
    needsYou: false,
    ...NO_FILTERS,
  }));
  const changeFilter = (next: ListFilter) => {
    if (next.view !== filter.view) writePref('jobs.view', next.view);
    setFilter(next);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whether a picked job has the window to itself, kept for next time.
  const [expanded, setExpanded] = usePref('panel.expanded', false, isBoolean);
  const [dialog, setDialog] = useState<
    'add-job' | 'find-jobs' | 'journey' | 'sync' | 'claude-settings' | null
  >(null);
  const search = useRef<HTMLInputElement>(null);
  const viewChosen = useRef(false);
  // The page the user picked in the sidebar, or null to let the app choose.
  const [picked, setPicked] = useState<Page | null>(null);
  const profile = about.profile;
  const gettingStarted = profile !== null && needsGettingStarted(profile);
  // A brand-new user starts on getting started, unless they skipped it. Once there are jobs,
  // such as when sync brings them from another computer, the app opens on them instead.
  const page: Page =
    picked ??
    (gettingStarted &&
    !profile?.answers.skipped &&
    jobs.state === 'ready' &&
    jobs.list.jobs.length === 0
      ? 'profile'
      : 'jobs');

  // The first time, open on the view furthest along that has jobs in it, once there are some,
  // such as when sync brings them to a new computer. After that, the view the user last picked.
  useEffect(() => {
    if (viewChosen.current || jobs.state !== 'ready' || rows.length === 0) return;
    viewChosen.current = true;
    if (readPref<JobView | null>('jobs.view', null, isView) !== null) return;
    setFilter((current) => ({ ...current, view: startingView(rows) }));
  }, [jobs.state, rows]);

  // ⌘K on a Mac, Ctrl K elsewhere, jumps to the search box.
  useEffect(() => {
    const jump = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', jump);
    return () => window.removeEventListener('keydown', jump);
  }, []);

  const ready = status !== 'checking' && status.state === 'ready';
  const plan = ready ? planName(status.plan) : undefined;
  const openJobs = rows.filter((row) => !row.job.archived).length;
  const selected = rows.find((row) => row.job.id === selectedId) ?? null;
  // The list as it shows, for moving from job to job while one has the window to itself.
  const shown = useMemo(() => visibleRows(rows, filter), [rows, filter]);
  // The list's order when a job took the window, to step through. It holds still as jobs get
  // new activity or leave the view, so the next job is always the next one the user saw.
  const [order, setOrder] = useState<string[]>([]);
  const alone = expanded && selected !== null && openJobs > 0;
  const keepOrder = () => setOrder(shown.map((row) => row.job.id));
  const at = order.indexOf(selectedId ?? '');
  const pick = (jobId: string) => {
    if (expanded) keepOrder();
    setSelectedId(jobId);
  };
  const step = (offset: -1 | 1) => {
    const ids = new Set(rows.map((row) => row.job.id));
    const next = stepFrom(order, selectedId ?? '', offset, (id) => ids.has(id));
    if (next) setSelectedId(next);
  };
  const runControls = useMemo<RunControls>(
    () => ({ phase: run.phase, task: run.task, start: run.requestStart, show: run.show }),
    [run.phase, run.task, run.requestStart, run.show],
  );
  // The run's name in Claude's panel, such as "Fit check · Acme", when a Run button started it.
  const task = run.task;
  const runJob = rows.find((row) => row.job.id === taskJob(task))?.job;
  const runLabel =
    task?.skill === 'ask'
      ? 'Your question'
      : task && RUN_ACTIONS.find((action) => action.skill === task.skill)?.label;
  const runTitle =
    task?.skill === SEARCH_SKILL
      ? 'Job search'
      : task?.skill === GET_STARTED_SKILL
        ? 'Getting to know you'
        : task?.skill === FACTS_SKILL
          ? 'Your fact bank'
          : task?.skill === TEMPLATE_SKILL
            ? 'A template of your own'
            : runJob && runLabel
              ? `${runLabel} · ${runJob.company}`
              : undefined;

  return (
    <div className={styles.app}>
      <TopBar
        platform={api.platform}
        query={filter.query}
        onQuery={(query) => {
          setFilter((current) => ({ ...current, query }));
          // Searching while a job has the window brings back the list, to show what matches.
          if (alone) setSelectedId(null);
        }}
        searchRef={search}
        onAddJob={() => setDialog('add-job')}
      />
      <div className={styles.body}>
        <Sidebar
          page={page}
          onPage={(next) => {
            // Leaving getting started for the jobs counts as skipping it for now.
            if (next === 'jobs' && gettingStarted && profile && !profile.answers.skipped) {
              about.update({ skipped: true });
            }
            setPicked(next);
          }}
          gettingStarted={gettingStarted}
          claude={status}
          onRecheckClaude={recheck}
          setup={setup}
          sync={sync}
          onOpenSync={() => setDialog('sync')}
          onOpenClaudeSettings={() => setDialog('claude-settings')}
          jobCount={jobs.state === 'ready' ? openJobs : undefined}
        />
        <div className={styles.content}>
          <div className={styles.work}>
            {page === 'profile' && profile && gettingStarted && (
              <GetStarted
                state={{ ...about, profile }}
                api={api}
                claude={status}
                onRecheckClaude={recheck}
                canStartClaude={ready && !BUSY.includes(run.phase)}
                onStart={() => {
                  // The profile follows Claude as it gets to know the user.
                  setPicked('profile');
                  run.requestStart({ skill: GET_STARTED_SKILL });
                }}
                onMakeTemplate={(source) => run.requestStart({ skill: TEMPLATE_SKILL, source })}
                onSkip={() => {
                  about.update({ skipped: true });
                  setPicked('jobs');
                }}
                onOpenSync={() => setDialog('sync')}
              />
            )}
            {page === 'profile' && profile && !gettingStarted && (
              <ProfilePage
                state={{ ...about, profile }}
                api={api}
                phase={run.phase}
                ready={ready}
                onRun={(next) => run.requestStart(next)}
              />
            )}
            {page === 'profile' && !profile && (
              <main className={styles.loading} role="status">
                {about.problem ?? 'Loading your profile…'}
              </main>
            )}
            {page === 'jobs' && !alone && (
              <JobsPage
                jobs={jobs}
                rows={rows}
                today={today}
                filter={filter}
                onFilter={changeFilter}
                selectedId={selectedId}
                onSelect={pick}
                onRetry={reload}
                canStartClaude={ready && !isRunning(run.phase)}
                onStartClaude={() => run.requestStart()}
                canFindJobs={ready && !BUSY.includes(run.phase)}
                onFindJobs={() => setDialog('find-jobs')}
                onOpenJourney={() => setDialog('journey')}
                onGetStarted={gettingStarted ? () => setPicked('profile') : undefined}
              />
            )}
            {page === 'jobs' && openJobs > 0 && (
              <JobPanel
                row={selected}
                api={api}
                today={today}
                onClose={() => setSelectedId(null)}
                expanded={alone}
                onExpand={(next) => {
                  if (next) keepOrder();
                  setExpanded(next);
                }}
                {...(alone &&
                  at >= 0 && { navigation: { index: at + 1, count: order.length, onStep: step } })}
                {...(ready && { run: runControls })}
              />
            )}
          </div>
          <ClaudePanel api={api} run={run} plan={plan} title={runTitle} />
        </div>
      </div>
      {dialog === 'add-job' && (
        <AddJobDialog
          api={api}
          onAdded={(jobId, status) => {
            // Show the new job in the list as well as the panel.
            changeFilter({ ...NO_FILTERS, view: viewOf(status), query: '', needsYou: false });
            setSelectedId(jobId);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'find-jobs' && (
        <FindJobsDialog
          today={today}
          onStart={(sources) => run.requestStart({ skill: SEARCH_SKILL, sources })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'journey' && (
        <JourneyDialog rows={rows} api={api} today={today} onClose={() => setDialog(null)} />
      )}
      {dialog === 'sync' && sync !== 'checking' && (
        <SyncDialog api={api} status={sync} onClose={() => setDialog(null)} />
      )}
      {dialog === 'claude-settings' && (
        <ClaudeSettingsDialog
          api={api}
          plan={ready ? status.plan : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
