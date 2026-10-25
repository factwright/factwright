import {
  JOB_VIEWS,
  type JobView,
  type KindName,
  type KindTarget,
  LIVE_STATUSES,
  sameCompany,
  viewOf,
} from '@factwright/core';
import { Button, Dialog, DialogActions } from '@factwright/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FactwrightApi, RunView } from '../shared/api.ts';
import { signInCommand } from '../shared/claude-commands.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { hasKinds, kindsOf } from '../shared/kinds.ts';
import type { ProfileEntry } from '../shared/profiles.ts';
import {
  GET_STARTED_SKILL,
  laneOf,
  type RunRequest,
  type RunTask,
  SEARCH_SKILL,
  TEMPLATE_SKILL,
} from '../shared/runs.ts';
import styles from './App.module.css';
import { GetStarted } from './about/GetStarted.tsx';
import { ProfilePage } from './about/ProfilePage.tsx';
import { needsGettingStarted, useProfile } from './about/useProfile.ts';
import {
  ClaudePanel,
  endsAsking,
  type PanelRun,
  type RunResult,
  turnErrorWords,
} from './ClaudePanel.tsx';
import { ClaudePermission } from './ClaudePermission.tsx';
import { ClaudeQuestions } from './ClaudeQuestions.tsx';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog.tsx';
import { ExtensionDialog } from './extension/ExtensionDialog.tsx';
import { FactBankPage } from './facts/FactBankPage.tsx';
import { AddJobDialog } from './jobs/AddJobDialog.tsx';
import { FindJobsDialog } from './jobs/FindJobsDialog.tsx';
import { JobPanel } from './jobs/JobPanel.tsx';
import { JobRail } from './jobs/JobRail.tsx';
import { JobsPage } from './jobs/JobsPage.tsx';
import { JourneyDialog } from './jobs/JourneyDialog.tsx';
import { MergeDialog } from './jobs/MergeDialog.tsx';
import { showSection } from './jobs/PanelSection.tsx';
import { BUSY, requestedRun, runControlsFor, type TaskState } from './jobs/RunActions.tsx';
import {
  filterForAdded,
  isListSort,
  type JobRow,
  jobRows,
  type ListFilter,
  type ListSort,
  NO_FILTERS,
  startingView,
  stepFrom,
  viewNow,
  visibleRows,
  withKnownKind,
} from './jobs/rows.ts';
import { useCallReminders } from './jobs/useCallReminders.ts';
import { useJobs } from './jobs/useJobs.ts';
import { useCallClock, useToday } from './jobs/useToday.ts';
import { WithdrawDialog } from './jobs/WithdrawDialog.tsx';
import { planName } from './plan.ts';
import { isBoolean, readPref, usePref, writePref } from './prefs.ts';
import { AddProfileDialog } from './profiles/AddProfileDialog.tsx';
import { ManageProfilesDialog } from './profiles/ManageProfilesDialog.tsx';
import { useProfiles } from './profiles/useProfiles.ts';
import { tabState } from './RunTabs.tsx';
import {
  makesSomething,
  type RunBefore,
  type RunPlace,
  runBefore,
  runOutcome,
} from './runOutcome.ts';
import { runTitle } from './runTitle.ts';
import { type Page, Sidebar } from './Sidebar.tsx';
import { SyncDialog } from './sync/SyncDialog.tsx';
import { useApprovals, useSync } from './sync/useSync.ts';
import { TopBar } from './TopBar.tsx';
import { hasUnsaved } from './unsaved.ts';
import { useUpdates } from './updates/useUpdates.ts';
import { isOpen, startsNow, useClaudeRuns } from './useClaudeRuns.ts';
import { typedClaude, useClaudeStatus } from './useClaudeStatus.ts';
import { useLevelChoices } from './useLevelChoices.ts';
import { useRunActivity } from './useRunActivity.ts';
import { useRunChanges } from './useRunChanges.ts';
import { useSetupCheck } from './useSetupCheck.ts';
import { type Choice, type Turn, useWaitingTurns } from './useWaitingTurns.ts';

const isView = (value: unknown): value is JobView =>
  (JOB_VIEWS as readonly unknown[]).includes(value);

/**
 * How long after a task is done the window waits for what it made to show, in milliseconds, as
 * the jobs catch up with the workspace, before it says the task stopped short.
 */
const SETTLE_MS = 3000;

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
  const claude = useClaudeRuns(api);
  const runIds = useMemo(() => claude.runs.map((run) => run.id), [claude.runs]);
  const activityOf = useRunActivity(api, runIds);
  const changesOf = useRunChanges(api, runIds);
  const turns = useWaitingTurns(api);
  const { jobs, reload } = useJobs(api);
  const about = useProfile(api);
  const today = useToday();
  const listed = useMemo(() => (jobs.state === 'ready' ? jobs.list.jobs : []), [jobs]);
  const clock = useCallClock(listed, today);
  const update = useUpdates(api);
  const levels = useLevelChoices(api);
  const profiles = useProfiles(api);
  const reminders = useCallReminders(api);
  const profile = about.profile;
  // The user, by name and email, whom an invite for a call names among its people.
  const myName = profile?.answers.you.name ?? '';
  const myEmail = profile?.answers.you.email ?? '';
  const me = useMemo(() => ({ name: myName, email: myEmail }), [myName, myEmail]);
  // The kinds of job the user wants, by id and name, when there's more than one. They change
  // only when a kind is added, renamed or removed, so the rows aren't made again as they type.
  const kindKey = JSON.stringify(
    profile && hasKinds(profile.answers)
      ? kindsOf(profile.answers).map(({ id, name }) => ({ id, name }))
      : [],
  );
  const kinds = useMemo<KindName[]>(() => JSON.parse(kindKey), [kindKey]);
  // Each kind's target pay, for the pay to ask for at a job, which changes as a target does.
  const targetKey = JSON.stringify(
    profile
      ? kindsOf(profile.answers).map(({ id, name, targetPay }) => ({ id, name, targetPay }))
      : [],
  );
  const targets = useMemo<KindTarget[]>(() => JSON.parse(targetKey), [targetKey]);
  const rows = useMemo(
    () => (jobs.state === 'ready' ? jobRows(jobs.list.jobs, today, kinds, clock) : []),
    [jobs, today, kinds, clock],
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
  // The list's order: by a column the user sorted it by, kept for next time, or else the newest
  // activity first.
  const [sort, setSort] = usePref<ListSort | null>('jobs.sort', null, isListSort);
  const changeFilter = (next: ListFilter) => {
    if (next.view !== filter.view) writePref(VIEW_PREF, next.view);
    setFilter(next);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A job the app asked to open, such as from a call's reminder the user clicked, until the jobs
  // are in to open it among.
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => api.onOpenJob(setOpening), [api]);
  // Whether a picked job has the window to itself, kept for next time.
  const [expanded, setExpanded] = usePref('panel.expanded', false, isBoolean);
  const [dialog, setDialog] = useState<
    | 'add-job'
    | 'find-jobs'
    | 'journey'
    | 'sync'
    | 'claude-settings'
    | 'extension'
    | 'add-profile'
    | 'profiles'
    | 'merge'
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
  // What each run filed in the fact bank from the user's answers, and what of it the user has
  // seen, by opening it or dismissing the note, by the run's ID. A new run starts with nothing.
  const [filedIn, setFiled] = useState<
    Readonly<Record<string, { facts: FiledFacts; seen: { facts: string[]; gaps: number } }>>
  >({});
  useEffect(
    () =>
      api.onFactsFiled(({ runId, filed }) =>
        setFiled((all) => ({
          ...all,
          [runId]: { facts: filed, seen: all[runId]?.seen ?? { facts: [], gaps: 0 } },
        })),
      ),
    [api],
  );
  // Only what's new since the user last looked, by each save, so a fact Claude corrected
  // shows again.
  const factKey = ({ path, title, save }: FiledFacts['facts'][number]) =>
    `${path}#${title}#${save}`;
  const filedFor = (runId: string): FiledFacts | null => {
    const filedHere = filedIn[runId];
    return filedHere
      ? {
          facts: filedHere.facts.facts.filter(
            (each) => !filedHere.seen.facts.includes(factKey(each)),
          ),
          gaps: Math.max(0, filedHere.facts.gaps - filedHere.seen.gaps),
        }
      : null;
  };
  const seeFiled = (runId: string) =>
    setFiled((all) => {
      const was = all[runId];
      return was
        ? {
            ...all,
            [runId]: {
              ...was,
              seen: { facts: was.facts.facts.map(factKey), gaps: was.facts.gaps },
            },
          }
        : all;
    });
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

  // A job to open shows on the jobs page, in the list in its own view as well as in the panel.
  useEffect(() => {
    if (!opening || jobs.state !== 'ready') return;
    setOpening(null);
    const row = rows.find((each) => each.job.id === opening);
    if (!row) return;
    setPicked('jobs');
    setFilter((current) => filterForAdded(current, row.progress.status, row.kind?.id ?? null));
    writePref(VIEW_PREF, viewOf(row.progress.status));
    setSelectedId(row.job.id);
  }, [opening, jobs.state, rows]);

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
  // An added profile has its own Claude login, which it signs in to with its own command, naming
  // its own Claude Code folder.
  const claudeFolder = currentProfile && !currentProfile.first && profiles.list?.claudeFolder;
  const ownSignIn = claudeFolder
    ? signInCommand(api.platform, claudeFolder, typedClaude(status))
    : undefined;
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
  // The user's other jobs at the same company, for the history with it.
  const related = useMemo(
    () =>
      selected
        ? rows
            .map((row) => row.job)
            .filter((job) => job.id !== selected.job.id && sameCompany(job, selected.job))
        : [],
    [rows, selected],
  );
  // The list as it shows, for moving from job to job while one has the window to itself.
  const shown = useMemo(() => visibleRows(rows, filter, sort), [rows, filter, sort]);
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
  const { start: startClaude, close: closeRun, show: showRun } = claude;
  const startRun = useCallback((next?: RunTask) => startClaude(next), [startClaude]);
  // Whether a task waits in line, or has a run going, on a job or a part of the job hunt.
  const taken = (lane: string) =>
    claude.runs.some(
      (run) => (run.phase === 'in-line' || BUSY.includes(run.phase)) && laneOf(run.task) === lane,
    );
  const runControls = useMemo(
    () => runControlsFor(claude.runs, startRun, showRun),
    [claude.runs, startRun, showRun],
  );
  // Whether Claude is on a task for a job, or has one in line for it, for the jobs list.
  const claudeOn = useCallback(
    (jobId: string): TaskState | null => {
      const tasks = runControls.tasksOn(jobId);
      if (tasks.length === 0) return null;
      return tasks.some(({ state }) => state === 'running') ? 'running' : 'in-line';
    },
    [runControls],
  );

  // A job the window goes to for what a run made, with the section of its panel to show it in,
  // once the job has opened.
  const [reveal, setReveal] = useState<{ jobId: string; section: string } | null>(null);
  useEffect(() => {
    if (!reveal || page !== 'jobs' || selectedId !== reveal.jobId) return;
    setReveal(null);
    requestAnimationFrame(() => showSection(reveal.section));
  }, [reveal, page, selectedId]);
  const goTo = (place: RunPlace) => {
    if ('page' in place) {
      setPicked(place.page);
      return;
    }
    setPicked('jobs');
    if ('view' in place) {
      setSelectedId(null);
      changeFilter({
        ...filter,
        ...NO_FILTERS,
        kind: filter.kind,
        view: place.view,
        query: '',
        needsYou: false,
      });
      return;
    }
    setOpening(place.jobId);
    if (place.section) setReveal({ jobId: place.jobId, section: place.section });
  };
  // What the jobs looked like as each run started, to tell once it's done what it made. A task
  // that waits in line starts later, so what it starts from is taken once it does.
  const [befores, setBefores] = useState<Readonly<Record<string, RunBefore>>>({});
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const runsNow = useRef(claude.runs);
  runsNow.current = claude.runs;
  const startedKey = claude.runs
    .filter((run) => run.phase !== 'in-line')
    .map((run) => run.id)
    .join(' ');
  useEffect(() => {
    const started = new Set(startedKey.split(' ').filter(Boolean));
    setBefores((all) => {
      const kept = Object.entries(all).filter(([id]) => started.has(id));
      const fresh = runsNow.current
        .filter((run) => started.has(run.id) && !all[run.id])
        .map((run) => [run.id, runBefore(run.task, rowsNow.current)] as const);
      return fresh.length === 0 && kept.length === Object.keys(all).length
        ? all
        : Object.fromEntries([...kept, ...fresh]);
    });
  }, [startedKey]);
  // Which runs have been done a few moments, as the jobs catch up with what they made. With
  // nothing to show by then, a run stopped short of what it was for, such as to ask something.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const settling = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const doneKey = claude.runs
    .filter((run) => run.phase === 'done')
    .map((run) => run.id)
    .join(' ');
  useEffect(() => {
    const done = new Set(doneKey.split(' ').filter(Boolean));
    for (const [id, timer] of settling.current) {
      if (done.has(id)) continue;
      clearTimeout(timer);
      settling.current.delete(id);
    }
    setSettled((was) => {
      const still = [...was].filter((id) => done.has(id));
      return still.length === was.size ? was : new Set(still);
    });
    for (const id of done) {
      if (settling.current.has(id)) continue;
      settling.current.set(
        id,
        setTimeout(() => setSettled((was) => new Set(was).add(id)), SETTLE_MS),
      );
    }
  }, [doneKey]);
  useEffect(() => {
    const timers = settling.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  // Each run as its tab and bar show it: its name, what it's done and made, and what it waits on
  // the user for.
  const titleOf = (run: RunView) => runTitle(run.task, listed);
  const panelRuns = claude.runs.map((view): PanelRun => {
    const activity = activityOf(view.id);
    const before = befores[view.id];
    const outcome =
      view.phase === 'done' && before ? runOutcome(before, rows, activity.steps) : null;
    const result: RunResult | null = outcome && {
      text: outcome.text,
      open: outcome.place && {
        label: 'view' in outcome.place ? 'See them' : 'Open it',
        go: () => outcome.place && goTo(outcome.place),
      },
    };
    const waiting = turns.turns.filter((turn) => turn.item.runId === view.id);
    const first = waiting[0];
    const task = view.task;
    return {
      view,
      title: titleOf(view),
      state: tabState(view, {
        waiting: waiting.length > 0 || endsAsking(view.phase, activity, result),
        failed: view.phase === 'done' && Boolean(activity.end?.error),
      }),
      activity,
      result,
      stoppedShort: settled.has(view.id) && !outcome && makesSomething(view.task),
      onRetry: task
        ? () => {
            // The task starts again in a run of its own, in place of this one.
            closeRun(view.id);
            startRun(task);
          }
        : undefined,
      filed: filedFor(view.id),
      changes: changesOf(view.id),
      asking: first
        ? {
            what: first.kind,
            count: first.kind === 'questions' ? first.item.questions.length : 1,
            open: turns.shown?.item.runId === view.id,
            onAnswer: () => turns.show(view.id),
          }
        : null,
    };
  });
  // Work going, which restarting the app would stop: a run that's starting, working or waiting on
  // the user, as for a reply to a question Claude asked in its own words, or a task in line.
  // Updates and switching profiles wait for it. Claude Code that's done closes as the app restarts.
  const workGoing = panelRuns.some(
    ({ view, state }) =>
      view.phase === 'in-line' || BUSY.includes(view.phase) || state === 'waiting',
  );
  // Opens what the task made from the notification that says so, too: the last one told of.
  const openResult = useRef<(() => void) | null>(null);
  useEffect(() => api.onOpenRunResult(() => openResult.current?.()), [api]);
  // A run the app asks for, as when the browser extension asks for drafts of a form's questions,
  // starts as a Run button's does, if it can start now, without waiting in line, and once Claude
  // Code is ready. The window stays where it is.
  const runRequested = useRef<(request: RunRequest) => void>(() => {});
  runRequested.current = ({ id, task: asked }) => {
    const answer = requestedRun(ready, startsNow(claude, asked));
    api.answerRunRequest(id, answer);
    if (answer === 'started') startRun(asked);
  };
  useEffect(() => api.onRunRequest((request) => runRequested.current(request)), [api]);
  // A notification says what each task made, or that Claude is done, once, if the user is away.
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const { view, activity, result, title } of panelRuns) {
      if (view.phase !== 'done') {
        told.current.delete(view.id);
        continue;
      }
      if (told.current.has(view.id)) continue;
      const error = activity.end?.error;
      const said = activity.end?.said ?? null;
      const note = error
        ? { title: 'Claude didn’t finish', body: turnErrorWords(error.kind) }
        : result
          ? { title: result.text, body: 'Open Factwright to see it.' }
          : said?.endsWith('?')
            ? { title: 'Claude has a question for you', body: said }
            : settled.has(view.id)
              ? {
                  title: 'Claude is done',
                  body: `${view.task ? title : 'Your task'}. Open Factwright to see it.`,
                }
              : null;
      if (!note) continue;
      told.current.add(view.id);
      openResult.current = result?.open?.go ?? null;
      api.tellRunDone(note);
    }
  });

  // What the run asking the user is for, in the dialog's words, or null for Claude with no task.
  const aboutRun = (runId: string) => {
    const view = claude.runs.find((run) => run.id === runId);
    return view?.task ? titleOf(view) : null;
  };
  // With runs side by side, or several things waiting, the dialog names the run asking, and
  // which of them it is.
  const turnOf = (turn: Turn) => {
    if (claude.runs.length < 2 && turns.turns.length < 2) return undefined;
    const view = claude.runs.find((run) => run.id === turn.item.runId);
    return {
      run: view ? titleOf(view) : 'Claude',
      at: turns.turns.indexOf(turn) + 1,
      of: turns.turns.length,
      go: turns.go,
    };
  };
  const shownRound = turns.shown?.kind === 'questions' ? turns.shown.item.id : null;
  const { keepDraft } = turns;
  const keepShownDraft = useCallback(
    (choices: Choice[]) => {
      if (shownRound) keepDraft(shownRound, choices);
    },
    [shownRound, keepDraft],
  );

  return (
    <div className={styles.app}>
      <TopBar
        platform={api.platform}
        query={filter.query}
        onQuery={(query) => {
          setFilter((current) => ({ ...current, query }));
          // Searching while a job has the window narrows the slim list beside it, to step through.
          if (alone)
            setOrder(visibleRows(rows, { ...filter, query }, sort).map((row) => row.job.id));
        }}
        searchRef={search}
        onAddJob={() => setDialog('add-job')}
      />
      <div className={styles.body}>
        <Sidebar
          {...(profiles.list && {
            profiles: {
              list: profileList,
              busy: workGoing,
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
          claudeSignIn={ownSignIn}
          copyText={api.copyText}
          terminal={api.platform === 'win32' ? 'PowerShell' : 'Terminal'}
          setup={setup}
          sync={sync}
          linkRequests={approvals.requests}
          linkAsking={approvals.asking}
          onOpenSync={() => setDialog('sync')}
          // Claude's panel, for Claude Code's first-run screens: a run that's open, or a new one.
          onOpenClaude={
            claude.selected && isOpen(claude.selected.phase)
              ? claude.open
                ? undefined
                : () => claude.show()
              : () => startRun()
          }
          onOpenClaudeSettings={() => setDialog('claude-settings')}
          onOpenExtension={() => setDialog('extension')}
          levels={levels.choices}
          jobCount={jobs.state === 'ready' ? openJobs : undefined}
          factCount={profile?.status.facts.claims || undefined}
          factsToVerify={profile?.status.facts.unconfirmed || undefined}
          update={{
            status: update,
            busy: workGoing,
            unsaved: hasUnsaved,
            // The profile saves as the user types, so what's waiting to save goes first. Facts and
            // notes have Save buttons: the card asks before restarting over them.
            onRestart: () =>
              about.flush().then(
                () => api.installUpdate(),
                () => api.installUpdate(),
              ),
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
                canStartClaude={ready && !taken('profile')}
                onStart={() => {
                  // The profile follows Claude as it gets to know the user.
                  setPicked('profile');
                  startRun({ skill: GET_STARTED_SKILL });
                }}
                onMakeTemplate={(source) => startRun({ skill: TEMPLATE_SKILL, source })}
                onSkip={() => {
                  about.update({ skipped: true });
                  setPicked('jobs');
                }}
                // Sync with Factwright's own server, set up by a copy that has it, isn't this one's.
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
                busy={taken('profile')}
                ready={ready}
                onRun={(next) => startRun(next)}
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
                sort={sort}
                onSort={setSort}
                selectedId={selectedId}
                onSelect={pick}
                onRetry={reload}
                canStartClaude={ready}
                onStartClaude={() => startRun()}
                // A search waits in line behind another, so Find jobs is never busy.
                canFindJobs={ready}
                claudeOn={claudeOn}
                onFindJobs={() => setDialog('find-jobs')}
                onOpenJourney={() => setDialog('journey')}
                onGetStarted={gettingStarted ? () => setPicked('profile') : undefined}
              />
            )}
            {page === 'jobs' && alone && (
              <JobRail
                rows={rows}
                kinds={kinds}
                today={today}
                filter={filter}
                onFilter={(next) => {
                  changeFilter(next);
                  // Another view or filter is another list to step through.
                  setOrder(visibleRows(rows, next, sort).map((row) => row.job.id));
                }}
                sort={sort}
                selectedId={selectedId}
                onSelect={pick}
              />
            )}
            {page === 'jobs' && openJobs > 0 && (
              <JobPanel
                row={selected}
                api={api}
                kinds={kinds}
                targets={targets}
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
                related={related}
                me={me}
                reminders={reminders ?? undefined}
                onMerge={() => setDialog('merge')}
              />
            )}
          </div>
          <ClaudePanel
            api={api}
            runs={panelRuns}
            claude={claude}
            plan={plan}
            onReviewFiled={(runId, part) => {
              seeFiled(runId);
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
          api={api}
          today={today}
          kinds={kinds}
          onStart={(sources) => startRun({ skill: SEARCH_SKILL, sources })}
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
      {dialog === 'merge' && selected && (
        <MergeDialog job={selected.job} rows={rows} api={api} onClose={() => setDialog(null)} />
      )}
      {withdraw && (
        <WithdrawDialog
          company={withdraw.company}
          rows={withdraw.rows}
          api={api}
          onClose={() => setWithdraw(null)}
        />
      )}
      {dialog === 'extension' && <ExtensionDialog api={api} onClose={() => setDialog(null)} />}
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
          busy={workGoing}
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
      {turns.shown?.kind === 'questions' && (
        <ClaudeQuestions
          key={turns.shown.item.id}
          api={api}
          round={turns.shown.item}
          about={aboutRun(turns.shown.item.runId)}
          turn={turnOf(turns.shown)}
          draft={turns.draft(turns.shown.item.id)}
          onDraft={keepShownDraft}
          // Answered, it goes on to what waits next, as the app takes the round off the list.
          onAnswered={() => {}}
          onClose={turns.hide}
        />
      )}
      {turns.shown?.kind === 'permission' && (
        <ClaudePermission
          key={turns.shown.item.id}
          api={api}
          ask={turns.shown.item}
          about={aboutRun(turns.shown.item.runId)}
          turn={turnOf(turns.shown)}
          onAnswered={() => {}}
          onClose={turns.hide}
        />
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
