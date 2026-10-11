import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import styles from './App.module.css';
import { ClaudePanel } from './ClaudePanel.tsx';
import { AddJobDialog } from './jobs/AddJobDialog.tsx';
import { JobPanel } from './jobs/JobPanel.tsx';
import { JobsPage } from './jobs/JobsPage.tsx';
import { JourneyDialog } from './jobs/JourneyDialog.tsx';
import { jobRows, type ListFilter, NO_FILTERS, startingView } from './jobs/rows.ts';
import { useJobs } from './jobs/useJobs.ts';
import { useToday } from './jobs/useToday.ts';
import { isRunning } from './PanelHeader.tsx';
import { planName } from './plan.ts';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { useClaudeRun } from './useClaudeRun.ts';
import { useClaudeStatus } from './useClaudeStatus.ts';

/** The app's window: the top bar, the sidebar, the jobs and their details, and Claude's panel. */
export function App({ api }: { api: FactwrightApi }) {
  const { status, recheck } = useClaudeStatus(api);
  const run = useClaudeRun(api);
  const { jobs, reload } = useJobs(api);
  const today = useToday();
  const rows = useMemo(
    () => (jobs.state === 'ready' ? jobRows(jobs.list.jobs, today) : []),
    [jobs, today],
  );
  const [filter, setFilter] = useState<ListFilter>({
    view: 'active',
    query: '',
    needsYou: false,
    ...NO_FILTERS,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'add-job' | 'journey' | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const viewChosen = useRef(false);

  // Open on the jobs to review when nothing is active yet.
  useEffect(() => {
    if (viewChosen.current || jobs.state !== 'ready') return;
    viewChosen.current = true;
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

  return (
    <div className={styles.app}>
      <TopBar
        platform={api.platform}
        query={filter.query}
        onQuery={(query) => setFilter((current) => ({ ...current, query }))}
        searchRef={search}
        onAddJob={() => setDialog('add-job')}
      />
      <div className={styles.body}>
        <Sidebar
          claude={status}
          onRecheckClaude={recheck}
          jobCount={jobs.state === 'ready' ? openJobs : undefined}
        />
        <div className={styles.content}>
          <div className={styles.work}>
            <JobsPage
              jobs={jobs}
              rows={rows}
              today={today}
              filter={filter}
              onFilter={setFilter}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRetry={reload}
              canStartClaude={ready && !isRunning(run.phase)}
              onStartClaude={run.requestStart}
              onOpenJourney={() => setDialog('journey')}
            />
            {openJobs > 0 && (
              <JobPanel
                row={selected}
                api={api}
                today={today}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
          <ClaudePanel api={api} run={run} plan={plan} />
        </div>
      </div>
      {dialog === 'add-job' && (
        <AddJobDialog
          api={api}
          onAdded={(jobId, status) => {
            // Show the new job in the list as well as the panel.
            setFilter({
              ...NO_FILTERS,
              view: status === 'new' ? 'review' : 'active',
              query: '',
              needsYou: false,
            });
            setSelectedId(jobId);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'journey' && (
        <JourneyDialog rows={rows} api={api} today={today} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
