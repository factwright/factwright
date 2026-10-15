import { JOB_VIEWS, type JobView, type KindName, LIVE_STATUSES } from '@factwright/core';
import { Button, Dialog, DialogActions } from '@factwright/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { hasKinds, kindsOf } from '../shared/kinds.ts';
import type { ProfileEntry } from '../shared/profiles.ts';
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
import { FactBankPage } from './facts/FactBankPage.tsx';
import { AddJobDialog } from './jobs/AddJobDialog.tsx';
import { FindJobsDialog } from './jobs/FindJobsDialog.tsx';
import { JobPanel } from './jobs/JobPanel.tsx';
import { JobsPage } from './jobs/JobsPage.tsx';
import { JourneyDialog } from './jobs/JourneyDialog.tsx';
import { BUSY, RUN_ACTIONS, type RunControls } from './jobs/RunActions.tsx';
import {
  filterForAdded,
  type JobRow,
  jobRows,
  type ListFilter,
  NO_FILTERS,
  startingView,
  stepFrom,
  viewNow,
  visibleRows,
  withKnownKind,
} from './jobs/rows.ts';
import { useJobs } from './jobs/useJobs.ts';
import { useToday } from './jobs/useToday.ts';
import { WithdrawDialog } from './jobs/WithdrawDialog.tsx';
import { isRunning } from './PanelHeader.tsx';
import { planName } from './plan.ts';
import { isBoolean, readPref, usePref, writePref } from './prefs.ts';
import { AddProfileDialog } from './profiles/AddProfileDialog.tsx';
import { ManageProfilesDialog } from './profiles/ManageProfilesDialog.tsx';
import { useProfiles } from './profiles/useProfiles.ts';
import { type Page, Sidebar } from './Sidebar.tsx';
import { SyncDialog } from './sync/SyncDialog.tsx';
import { useApprovals, useSync } from './sync/useSync.ts';
import { TopBar } from './TopBar.tsx';
import { hasUnsaved } from './unsaved.ts';
import { useUpdates } from './updates/useUpdates.ts';
import { useClaudeRun } from './useClaudeRun.ts';
import { useClaudeStatus } from './useClaudeStatus.ts';
import { useLevelChoices } from './useLevelChoices.ts';
import { useSetupCheck } from './useSetupCheck.ts';

const isView = (value: unknown): value is JobView =>
  (JOB_VIEWS as readonly unknown[]).includes(value);

/** Where the view the user last picked is kept. Earlier versions kept theirs as jobs.view. */
const VIEW_PREF = 'jobs.lastView';

/** The view the user last picked, in this version's views, or null the first time. */
const keptView = () =>
  readPref<JobView | null>(VIEW_PREF, null, isView) ??
  viewNow(readPref<JobView | null>('jobs.view', null, isView));

/** The app's window: the top bar, the sidebar, the jobs and their details, and Claude's panel. */
export function App({ api }: { api: FactwrightApi }) {
  const { status, recheck } = useClaudeStatus(api);
  const setup = useSetupCheck(api);
  const sync = useSync(api);
  const approvals = useApprovals(api);
  const run = useClaudeRun(api);
  const { jobs, reload } = useJobs(api);
  const about = useProfile(api);
  const today = useToday();
  const update = useUpdates(api);
  const levels = useLevelChoices(api);
  const profiles = useProfiles(api);
  const profile = about.profile;
  // The kinds of job the user wants, by id and name, when there's more than one. They change
  // only when a kind is added, renamed or removed, so the rows aren't made again as they type.
  const kindKey = JSON.stringify(
    profile && hasKinds(profile.answers)
      ? kindsOf(profile.answers).map(({ id, name }) => ({ id, name }))
      : [],
  );
  const kinds = useMemo<KindName[]>(() => JSON.parse(kindKey), [kindKey]);
  const rows = useMemo(
    () => (jobs.state === 'ready' ? jobRows(jobs.list.jobs, today, kinds) : []),
    [jobs, today, kinds],
  );
  // The view the user last picked, or, the first time, one chosen once the jobs load.
  const [chosen, setFilter] = useState<ListFilter>(() => ({
    view: keptView() ?? 'new',
    query: '',
    needsYou: false,
    ...NO_FILTERS,
  }));
  // A kind of job picked, then removed, shows every kind again.
  const filter = withKnownKind(chosen, kinds);
  const changeFilter = (next: ListFilter) => {
    if (next.view !== filter.view) writePref(VIEW_PREF, next.view);
    setFilter(next);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whether a picked job has the window to itself, kept for next time.
  const [expanded, setExpanded] = usePref('panel.expanded', false, isBoolean);
  const [dialog, setDialog] = useState<
    | 'add-job'
    | 'find-jobs'
    | 'journey'
    | 'sync'
    | 'claude-settings'
    | 'add-profile'
    | 'profiles'
    | null
  >(null);
  // Once the user accepts an offer, the company and the other jobs still in play, to withdraw from.
  const [withdraw, setWithdraw] = useState<{ company: string; rows: JobRow[] } | null>(null);
  // A profile to switch to, once the user says what they're writing can go unsaved.
  const [switching, setSwitching] = useState<ProfileEntry | null>(null);
  const [profileProblem, setProfileProblem] = useState<string | null>(null);
  // A profile that stopped short of opening last time, which the user hears about once.
  const [stoppedSeen, setStoppedSeen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const viewChosen = useRef(false);
  // The page the user picked in the sidebar, or null to let the app choose.
  const [picked, setPicked] = useState<Page | null>(null);
  // What the run filed in the fact bank from the user's answers, and how much of it the user
  // has seen, by opening it or dismissing the note. A new run starts with nothing filed.
  const [filedIn, setFiled] = useState<{
    runId: number;
    facts: FiledFacts;
    seen: { facts: number; gaps: number };
  } | null>(null);
  const runId = useRef(run.runId);
  runId.current = run.runId;
  useEffect(
    () =>
      api.onFactsFiled((facts) =>
        setFiled((was) => ({
          runId: runId.current,
          facts,
          seen: was?.runId === runId.current ? was.seen : { facts: 0, gaps: 0 },
        })),
      ),
    [api],
  );
  // Only what's new since the user last looked.
  const filed: FiledFacts | null =
    filedIn?.runId === run.runId
      ? {
          facts: filedIn.facts.facts.slice(filedIn.seen.facts),
          gaps: Math.max(0, filedIn.facts.gaps - filedIn.seen.gaps),
        }
      : null;
  const seeFiled = () =>
    setFiled((was) =>
      was ? { ...was, seen: { facts: was.facts.facts.length, gaps: was.facts.gaps } } : was,
    );
  // A part of the fact bank to go to, such as the facts a run just filed.
  const [factsShown, setFactsShown] = useState<{ part: 'unverified' | 'gaps'; at: number } | null>(
    null,
  );
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

  // Going to a part of the fact bank lasts while it shows: back from elsewhere, it opens as usual.
  useEffect(() => {
    if (page !== 'facts') setFactsShown(null);
  }, [page]);

  // The first time, open on the view furthest along that has jobs in it, once there are some,
  // such as when sync brings them to a new computer. After that, the view the user last picked.
  useEffect(() => {
    if (viewChosen.current || jobs.state !== 'ready' || rows.length === 0) return;
    viewChosen.current = true;
    if (keptView() !== null) return;
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
  const offerAccepted = (jobId: string) => {
    const inPlay = rows.filter(
      (row) =>
        row.job.id !== jobId && !row.job.archived && LIVE_STATUSES.includes(row.progress.status),
    );
    const company = rows.find((row) => row.job.id === jobId)?.job.company ?? 'the company';
    if (inPlay.length > 0) setWithdraw({ company, rows: inPlay });
  };
  const plan = ready ? planName(status.plan) : undefined;

  const profileList = profiles.list?.profiles ?? [];
  const currentProfile = profileList.find((each) => each.open);
  // An added profile has its own Claude login, which it signs in to with its own command.
  const ownSignIn =
    currentProfile && !currentProfile.first ? profiles.list?.claudeSignIn : undefined;
  // Restarts the app on another profile, once what's waiting to save is saved.
  const switchTo = async (target: ProfileEntry) => {
    await about.flush();
    const result = await api
      .openProfile(target.id)
      .catch(() => ({ ok: false as const, message: 'Factwright couldn’t switch. Try again.' }));
    if (!result.ok) setProfileProblem(result.message);
  };
  const askToSwitch = (target: ProfileEntry) => {
    if (hasUnsaved()) setSwitching(target);
    else void switchTo(target);
  };

  // With more than one profile, the window's title says whose job hunt it is.
  const titled = profileList.length > 1 ? currentProfile?.name : undefined;
  useEffect(() => {
    document.title = titled ? `Factwright · ${titled}` : 'Factwright';
  }, [titled]);
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
          {...(profiles.list && {
            profiles: {
              list: profileList,
              busy: isRunning(run.phase),
              onOpen: askToSwitch,
              onAdd: () => setDialog('add-profile'),
              onManage: () => setDialog('profiles'),
            },
          })}
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
          claudeSignIn={ownSignIn ? { command: ownSignIn, copy: api.copyText } : undefined}
          terminal={api.platform === 'win32' ? 'PowerShell' : 'Terminal'}
          setup={setup}
          sync={sync}
          linkRequests={approvals.requests}
          linkAsking={approvals.asking}
          onOpenSync={() => setDialog('sync')}
          onOpenClaudeSettings={() => setDialog('claude-settings')}
          levels={levels.choices}
          jobCount={jobs.state === 'ready' ? openJobs : undefined}
          factCount={profile?.status.facts.claims || undefined}
          factsToVerify={profile?.status.facts.unconfirmed || undefined}
          update={{
            status: update,
            busy: isRunning(run.phase),
            unsaved: hasUnsaved,
            onRestart: () => {
              // The profile saves as the user types, so what's waiting to save goes first. Facts and
              // notes have Save buttons: the card asks before restarting over them.
              void about.flush().finally(() => api.installUpdate());
            },
          }}
          version={api.version}
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
                // A copy built without a sync server doesn't offer it.
                onOpenSync={
                  sync !== 'checking' && sync.state === 'no-server' ? null : () => setDialog('sync')
                }
                claudeSignIn={ownSignIn}
                onAddProfile={profiles.list ? () => setDialog('add-profile') : null}
              />
            )}
            {page === 'profile' && profile && !gettingStarted && (
              <ProfilePage
                state={{ ...about, profile }}
                api={api}
                phase={run.phase}
                ready={ready}
                onRun={(next) => run.requestStart(next)}
                onOpenFacts={() => setPicked('facts')}
                {...(profiles.list && {
                  profiles: {
                    list: profileList,
                    onAdd: () => setDialog('add-profile'),
                    onManage: () => setDialog('profiles'),
                  },
                })}
              />
            )}
            {page === 'facts' && (
              <FactBankPage
                api={api}
                today={today}
                onGetStarted={() => setPicked('profile')}
                show={factsShown}
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
                api={api}
                rows={rows}
                kinds={kinds}
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
                kinds={kinds}
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
                onAccepted={offerAccepted}
              />
            )}
          </div>
          <ClaudePanel
            api={api}
            run={run}
            plan={plan}
            title={runTitle}
            filed={filed}
            onReviewFiled={(part) => {
              seeFiled();
              setPicked('facts');
              setFactsShown((was) => ({ part, at: (was?.at ?? 0) + 1 }));
            }}
            onDismissFiled={seeFiled}
          />
        </div>
      </div>
      {dialog === 'add-job' && (
        <AddJobDialog
          api={api}
          kinds={kinds}
          // A job added while one kind shows is that kind's, to begin with.
          kind={filter.kind}
          onAdded={(jobId, status, kind) => {
            // Show the new job in the list as well as the panel.
            changeFilter(filterForAdded(filter, status, kind));
            setSelectedId(jobId);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'find-jobs' && (
        <FindJobsDialog
          today={today}
          kinds={kinds}
          onStart={(sources) => run.requestStart({ skill: SEARCH_SKILL, sources })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'journey' && (
        <JourneyDialog
          rows={rows}
          kinds={kinds}
          kind={filter.kind}
          api={api}
          today={today}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'sync' && sync !== 'checking' && (
        <SyncDialog api={api} status={sync} approvals={approvals} onClose={() => setDialog(null)} />
      )}
      {withdraw && (
        <WithdrawDialog
          company={withdraw.company}
          rows={withdraw.rows}
          api={api}
          onClose={() => setWithdraw(null)}
        />
      )}
      {dialog === 'claude-settings' && (
        <ClaudeSettingsDialog
          api={api}
          plan={ready ? status.plan : undefined}
          method={ready ? status.method : undefined}
          // The levels under Your Claude show each choice as it's saved.
          onSaved={levels.saved}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'add-profile' && (
        <AddProfileDialog
          api={api}
          busy={isRunning(run.phase)}
          firstName={
            currentProfile?.first && !currentProfile.named
              ? (profile?.answers.you.name ?? '')
              : undefined
          }
          onAdded={(added) => {
            profiles.reload();
            setDialog(null);
            askToSwitch(added);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'profiles' && profiles.list && (
        <ManageProfilesDialog
          api={api}
          profiles={profileList}
          onChanged={profiles.reload}
          onClose={() => {
            setDialog(null);
            // Removing down to one profile takes away what opened the dialog, so focus goes back
            // to the page the user is on.
            requestAnimationFrame(() => {
              if (document.activeElement !== document.body) return;
              document
                .querySelector<HTMLElement>('nav[aria-label="Main"] [aria-current="page"]')
                ?.focus();
            });
          }}
        />
      )}
      {switching && (
        <Dialog
          title={`Switch to ${switching.name}?`}
          description="Something you’re writing isn’t saved. Factwright restarts to switch, and it would be lost."
          onClose={() => setSwitching(null)}
        >
          {(close) => (
            <DialogActions>
              <Button onClick={close}>Not now</Button>
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  void switchTo(switching);
                }}
              >
                Switch anyway
              </Button>
            </DialogActions>
          )}
        </Dialog>
      )}
      {profiles.list?.stopped && !stoppedSeen && (
        <Dialog
          title={`${profiles.list.stopped} didn’t open`}
          description={`Last time, Factwright stopped before the profile “${profiles.list.stopped}” finished opening, so it opened this one. To try again, pick it at the top of the sidebar.`}
          onClose={() => setStoppedSeen(true)}
        >
          {(close) => (
            <DialogActions>
              <Button variant="primary" onClick={close}>
                OK
              </Button>
            </DialogActions>
          )}
        </Dialog>
      )}
      {profileProblem && (
        <Dialog
          title="Couldn’t switch profiles"
          description={profileProblem}
          onClose={() => setProfileProblem(null)}
        >
          {(close) => (
            <DialogActions>
              <Button variant="primary" onClick={close}>
                OK
              </Button>
            </DialogActions>
          )}
        </Dialog>
      )}
    </div>
  );
}
