import {
  askedFile,
  askId,
  CALL_STAGE,
  type Call,
  type Job,
  type JobShot,
  type JobStatus,
  localDate,
  parsePay,
  questionKey,
  SETTLED_STATUSES,
  STATUS_RANK,
  shotsFolder,
} from '@factwright/core';
import datesLastPdf from '@factwright/xray/fixtures/dates-last.pdf?url';
import engineerWord from '@factwright/xray/fixtures/engineer.docx?url';
import engineerPdf from '@factwright/xray/fixtures/engineer.pdf?url';
import footerPdf from '@factwright/xray/fixtures/footer.pdf?url';
import headerWord from '@factwright/xray/fixtures/header.docx?url';
import iconsPdf from '@factwright/xray/fixtures/icons.pdf?url';
import sidebarPdf from '@factwright/xray/fixtures/sidebar.pdf?url';
import spacedPdf from '@factwright/xray/fixtures/spaced.pdf?url';
import type { EditResult, FactwrightApi, JobChanges, JobList } from '../../shared/api.ts';
import type { Revision } from '../../shared/revision.ts';
import { sampleDocs, sampleJob, sampleJobs } from './sample-jobs.ts';
import { samplePdf } from './sample-pdf.ts';

/** A file the screens preview serves, as bytes. */
async function fileBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

/**
 * The resume every sample job and starting resume has, as a PDF and a Word file: one the engine
 * made, or, for ?resume=, one of the X-ray's files with a problem in it.
 */
const RESUMES: Readonly<Record<string, { pdf: string; word: string }>> = {
  engineer: { pdf: engineerPdf, word: engineerWord },
  spaced: { pdf: spacedPdf, word: headerWord },
  'dates-last': { pdf: datesLastPdf, word: headerWord },
  icons: { pdf: iconsPdf, word: headerWord },
  sidebar: { pdf: sidebarPdf, word: headerWord },
  footer: { pdf: footerPdf, word: headerWord },
};

type TrackerApi = Pick<
  FactwrightApi,
  | 'listJobs'
  | 'jobDocs'
  | 'updateJob'
  | 'updateJobs'
  | 'addJob'
  | 'addCall'
  | 'updateCall'
  | 'deleteCall'
  | 'redateStatusChange'
  | 'undoStatusChange'
  | 'addNote'
  | 'updateNote'
  | 'deleteNote'
  | 'onJobsChanged'
  | 'openFile'
  | 'readPdf'
  | 'readWord'
  | 'copyText'
  | 'saveFile'
  | 'jobExtras'
  | 'recordAnswer'
  | 'askAboutJob'
  | 'removeAsk'
  | 'addShot'
  | 'removeShot'
  | 'readShot'
  | 'pasteImage'
  | 'prepareRevision'
  | 'revisionOf'
>;

/** A resume's file name without its format, which its PDF and Word file share. */
const stemOf = (name: string) => name.replace(/\.(?:pdf|docx)$/i, '');

/** A sample job's folder, from where its files are, as the sample jobs keep none of their own. */
const folderOf = (job: Job) => job.folder ?? job.files[0]?.path.split('/')[1] ?? job.id;

/** A time as a previous version's folder: 2026-10-15-093012. */
const stampOf = (at: Date) => {
  const iso = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(':', '')}`;
};

/**
 * What ?revised shows: a revision of the job's resume, sent an hour before it was last built,
 * that fixed what it picked but a key term that's still missing.
 */
function sampleRevision(job: Job, resume: string): Revision | null {
  const file = job.files.find((each) => each.name === resume);
  if (!file) return null;
  const at = new Date(Date.parse(file.modified) - 3_600_000);
  const previous = `applications/${folderOf(job)}/previous/${stampOf(at)}`;
  return {
    at: at.toISOString(),
    resume,
    findings: [
      { id: 'check-dates', kind: 'content', title: 'Dates: 2 jobs’ dates may not be read' },
      { id: 'check-headings', kind: 'content', title: 'Sections: no Skills section' },
      { id: 'term-terraform', kind: 'content', title: 'Add “Terraform”' },
      { id: 'term-kubernetes', kind: 'question', title: 'Check “Kubernetes”' },
    ],
    before: '2 problems reading it · 3 of 11 key terms',
    previous,
    files: job.files
      .filter((each) => stemOf(each.name) === stemOf(resume))
      .map((each) => `${previous}/${each.name}`),
  };
}

/** What Claude answered about the sample jobs, by job and question. */
function sampleAnswer(question: string, on: string): string {
  return [
    `# ${question.split('\n')[0]}`,
    '',
    `Asked ${on}. Answered ${localDate()}.`,
    '',
    'Expect three people for 45 minutes: the hiring manager, a senior engineer and a product manager. Most panels there start with a walk through your resume, then one system you built, in depth.',
    '',
    '**Worth asking them:**',
    '- What would you want the platform team to have shipped a year from now?',
    '- How do product teams ask for platform work today?',
    '',
    '## Sources',
    '- Interview reports on Glassdoor, 2025 and 2026',
  ].join('\n');
}

const SAVED: EditResult = { ok: true };

/**
 * The tracker for the sample screens, kept in memory until the page reloads. It follows the
 * real tracker's main rules (a call moves a job forward, Undo puts it back) closely enough to
 * check the screens by eye. "jobs" picks the starting jobs: none, failed or loading.
 */
export function sampleTracker(
  jobs: string | null,
  resume: string | null = null,
  revised = false,
): TrackerApi {
  const files = RESUMES[resume ?? ''] ?? { pdf: engineerPdf, word: engineerWord };
  // Revisions sent in the sample screens, by job and resume, until the page reloads.
  const revisions = new Map<string, Revision>();
  const revisionKey = (jobId: string, name: string) => `${jobId}/${stemOf(name)}`;
  let list: JobList = {
    jobs: jobs === 'none' ? [] : sampleJobs(),
    readAt: new Date().toISOString(),
  };
  const listeners = new Set<(list: JobList) => void>();
  // Screenshots added in the sample screens, by path, and Claude's answers to questions.
  const shots = new Map<string, { shot: JobShot; bytes: Uint8Array }>();
  const asked = new Map<string, string>(
    list.jobs.flatMap((job) =>
      job.asks.map((ask) => [askedFile(job.id, ask.id), sampleAnswer(ask.question, ask.on)]),
    ),
  );
  let next = 0;
  const newId = (kind: string) => `${kind}-${++next}`;

  const publish = (updated: Job[]) => {
    list = { ...list, jobs: updated };
    for (const listener of listeners) listener(list);
    return SAVED;
  };
  const change = (test: (job: Job) => boolean, edit: (job: Job) => Job) =>
    publish(list.jobs.map((job) => (test(job) ? edit(job) : job)));
  const settled = (job: Job) => Boolean(job.status && SETTLED_STATUSES.includes(job.status));
  const mark = (job: Job, status: JobStatus, at: string): Job => ({
    ...job,
    status,
    statusOn: at,
    appliedOn: status === 'applied' && !job.appliedOn ? at : job.appliedOn,
    statusLog: [...job.statusLog, { id: newId('change'), status, at }],
  });
  /**
   * One job's change, as the real tracker makes it: a job set aside keeps the day it comes back,
   * and one passed on keeps why, each when given.
   */
  const edit = (job: Job, changes: JobChanges): Job => {
    let updated: Job = {
      ...job,
      ...(changes.nextAction !== undefined && {
        nextAction: changes.nextAction?.trim() || null,
      }),
      ...(changes.nextOn !== undefined && { nextOn: changes.nextOn }),
      ...(changes.appliedOn !== undefined && { appliedOn: changes.appliedOn }),
      ...(changes.earlierNotes !== undefined && {
        earlierNotes: changes.earlierNotes?.trim() || null,
      }),
      ...(changes.questions !== undefined && { questions: changes.questions }),
      ...(changes.archived !== undefined && { archived: changes.archived }),
      ...(changes.kind !== undefined && { kind: changes.kind }),
    };
    const { status } = changes;
    const moved = status !== undefined && status !== job.status;
    if (moved) {
      updated = status
        ? mark(updated, status, changes.statusOn ?? localDate())
        : { ...updated, status: null, statusOn: null };
    }
    if (changes.backOn !== undefined || (moved && status === 'later')) {
      updated = { ...updated, backOn: changes.backOn ?? null };
    }
    if (changes.passReason !== undefined || (moved && status === 'passed')) {
      updated = { ...updated, passReason: changes.passReason ?? null };
    }
    return updated;
  };

  return {
    listJobs: () =>
      jobs === 'loading'
        ? new Promise(() => {})
        : jobs === 'failed'
          ? Promise.reject(new Error('Sample failure'))
          : Promise.resolve(list),
    jobDocs: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      return job ? sampleDocs(job) : null;
    },
    updateJob: async (jobId, changes) =>
      change(
        (job) => job.id === jobId,
        (job) => edit(job, changes),
      ),
    updateJobs: async (jobIds, changes) =>
      change(
        (job) => jobIds.includes(job.id),
        (job) => edit(job, changes),
      ),
    addJob: async (input) => {
      const company = input.company.trim();
      if (!company) return { ok: false, message: 'Add the company’s name.' };
      const today = localDate();
      const range = input.pay ? parsePay(input.pay) : null;
      let job = sampleJob({
        id: newId('added'),
        company,
        role: input.role?.trim() ?? '',
        link: input.link || null,
        location: null,
        source: 'Added by hand',
        searches: [],
        manual: true,
        notes: input.notes?.trim()
          ? [
              {
                id: newId('note'),
                on: today,
                text: input.notes.trim(),
                at: new Date().toISOString(),
              },
            ]
          : [],
        firstSeen: today,
        lastActivity: today,
        kind: input.kind ?? null,
        pay: input.pay
          ? { text: input.pay, min: range?.min ?? null, max: range?.max ?? null, source: 'listed' }
          : null,
      });
      if (input.status) job = mark(job, input.status, today);
      publish([...list.jobs, job]);
      return { ok: true, jobId: job.id };
    },
    addCall: async (jobId, input) =>
      change(
        (job) => job.id === jobId,
        (job) => {
          const today = localDate();
          const past = input.onDate < today;
          const call: Call = {
            id: newId('call'),
            kind: input.kind,
            onDate: input.onDate,
            atTime: input.atTime ?? null,
            state: past ? 'done' : 'scheduled',
            outcome: null,
            notes: input.notes ?? null,
          };
          const calls = [...job.calls, call].sort((a, b) => a.onDate.localeCompare(b.onDate));
          const target = input.kind === 'other' ? undefined : CALL_STAGE[input.kind];
          const forward =
            target !== undefined &&
            !settled(job) &&
            (STATUS_RANK[target] ?? 0) > (STATUS_RANK[job.status ?? 'new'] ?? 0);
          const withCall = { ...job, calls };
          return forward ? mark(withCall, target, past ? input.onDate : today) : withCall;
        },
      ),
    updateCall: async (callId, changes) =>
      change(
        (job) => job.calls.some((call) => call.id === callId),
        (job) => {
          const before = job.calls.find((call) => call.id === callId);
          const updated = {
            ...job,
            calls: job.calls.map((call) => (call.id === callId ? { ...call, ...changes } : call)),
          };
          const rejects = changes.outcome === 'rejected' && before?.outcome !== 'rejected';
          return rejects && !settled(job) ? mark(updated, 'rejected', localDate()) : updated;
        },
      ),
    deleteCall: async (callId) =>
      change(
        () => true,
        (job) => ({ ...job, calls: job.calls.filter((call) => call.id !== callId) }),
      ),
    redateStatusChange: async (changeId, at) =>
      change(
        (job) => job.statusLog.some((entry) => entry.id === changeId),
        (job) => {
          const entry = job.statusLog.find((each) => each.id === changeId);
          const latest = job.statusLog.at(-1)?.id === changeId && job.status === entry?.status;
          return {
            ...job,
            statusLog: job.statusLog.map((each) => (each.id === changeId ? { ...each, at } : each)),
            statusOn: latest ? at : job.statusOn,
            appliedOn: entry?.status === 'applied' ? at : job.appliedOn,
          };
        },
      ),
    undoStatusChange: async (changeId) =>
      change(
        (job) => job.statusLog.some((entry) => entry.id === changeId),
        (job) => {
          const entry = job.statusLog.find((each) => each.id === changeId);
          const statusLog = job.statusLog.filter((each) => each.id !== changeId);
          const latest = job.statusLog.at(-1)?.id === changeId && job.status === entry?.status;
          const previous = statusLog.at(-1);
          const applied = statusLog.find((each) => each.status === 'applied');
          return {
            ...job,
            statusLog,
            status: latest ? (previous?.status ?? null) : job.status,
            statusOn: latest ? (previous?.at ?? null) : job.statusOn,
            appliedOn: entry?.status === 'applied' ? (applied?.at ?? null) : job.appliedOn,
          };
        },
      ),
    addNote: async (jobId, input) => {
      if (!input.text.trim()) return { ok: false, message: 'Type your note first.' };
      const note = {
        id: newId('note'),
        on: input.on ?? localDate(),
        text: input.text.trim(),
        at: new Date().toISOString(),
      };
      return change(
        (job) => job.id === jobId,
        (job) => ({ ...job, notes: [...job.notes, note] }),
      );
    },
    updateNote: async (noteId, changes) =>
      change(
        (job) => job.notes.some((note) => note.id === noteId),
        (job) => ({
          ...job,
          notes: job.notes.map((note) =>
            note.id === noteId
              ? {
                  ...note,
                  ...(changes.text !== undefined && { text: changes.text.trim() }),
                  ...(changes.on !== undefined && { on: changes.on }),
                }
              : note,
          ),
        }),
      ),
    deleteNote: async (noteId) =>
      change(
        (job) => job.notes.some((note) => note.id === noteId),
        (job) => ({ ...job, notes: job.notes.filter((note) => note.id !== noteId) }),
      ),
    onJobsChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    jobExtras: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      if (!job) return null;
      return {
        asked: Object.fromEntries(
          job.asks.flatMap((ask) => {
            const answer = asked.get(askedFile(job.id, ask.id));
            return answer ? [[ask.id, answer]] : [];
          }),
        ),
        shots: [...shots.values()]
          .map((each) => each.shot)
          .filter((shot) => shot.path.startsWith(`${shotsFolder(jobId)}/`)),
      };
    },
    recordAnswer: async (jobId, question, nth, text) =>
      change(
        (job) => job.id === jobId,
        (job) => {
          const others = job.sent.filter(
            (each) => questionKey(each.question) !== questionKey(question) || each.nth !== nth,
          );
          const answer = { question, nth, text, on: localDate(), at: new Date().toISOString() };
          return { ...job, sent: text.trim() ? [...others, answer] : others };
        },
      ),
    askAboutJob: async (jobId, question) => {
      const job = list.jobs.find((each) => each.id === jobId);
      if (!job) return { ok: false, message: 'That job isn’t in your tracker anymore.' };
      if (!question.trim()) return { ok: false, message: 'Type your question first.' };
      const id = askId(
        question,
        localDate(),
        job.asks.map((ask) => ask.id),
      );
      change(
        (each) => each.id === jobId,
        (each) => ({
          ...each,
          asks: [...each.asks, { id, question: question.trim(), on: localDate() }],
        }),
      );
      // Claude answers a moment later, as a run would.
      setTimeout(() => {
        asked.set(askedFile(jobId, id), sampleAnswer(question.trim(), localDate()));
        publish(list.jobs.map((each) => ({ ...each })));
      }, 2500);
      return { ok: true, askId: id };
    },
    removeAsk: async (jobId, id) => {
      asked.delete(askedFile(jobId, id));
      return change(
        (job) => job.id === jobId,
        (job) => ({ ...job, asks: job.asks.filter((ask) => ask.id !== id) }),
      );
    },
    addShot: async (jobId, upload, purpose) => {
      const stem = purpose.kind === 'ask' ? `ask-${purpose.ask}` : `form-${localDate()}`;
      const name = `${stem}-${shots.size + 1}.png`;
      const path = `${shotsFolder(jobId)}/${name}`;
      const shot: JobShot = {
        path,
        name,
        kind: purpose.kind,
        ask: purpose.kind === 'ask' ? purpose.ask : null,
        size: upload.bytes.length,
        modified: new Date().toISOString(),
      };
      shots.set(path, { shot, bytes: upload.bytes });
      return { ok: true, path };
    },
    removeShot: async (path) => {
      shots.delete(path);
      return SAVED;
    },
    readShot: async (path) => shots.get(path)?.bytes ?? null,
    pasteImage: async () => ({ ok: true, file: '/sample/workspace/screenshots/pasted-1.png' }),
    openFile: async () => ({ ok: false, message: 'The sample screens can’t open files.' }),
    // Every resume is the same made-up one, made by the engine as the app makes it. A cover
    // letter shows the sample page.
    readPdf: async (path) => ({
      ok: true,
      data: /CoverLetter/.test(path) ? samplePdf() : await fileBytes(files.pdf),
    }),
    readWord: async () => ({ ok: true, data: await fileBytes(files.word) }),
    // The sample screens keep no files, so a revision only remembers what was sent.
    prepareRevision: async (request) => {
      const job = list.jobs.find((each) => each.id === request.jobId);
      if (!job) return { ok: false, message: 'That job isn’t on file anymore.' };
      const at = new Date();
      const previous = `applications/${folderOf(job)}/previous/${stampOf(at)}`;
      revisions.set(revisionKey(job.id, request.resume), {
        at: at.toISOString(),
        resume: request.resume,
        findings: request.findings.map(({ id, kind, title }) => ({ id, kind, title })),
        ...(request.template && { template: request.template }),
        before: request.before,
        previous,
        files: job.files
          .filter((file) => stemOf(file.name) === stemOf(request.resume))
          .map((file) => `${previous}/${file.name}`),
      });
      return { ok: true };
    },
    revisionOf: async (jobId, name) => {
      const sent = revisions.get(revisionKey(jobId, name));
      if (sent || !revised) return sent ?? null;
      const job = list.jobs.find((each) => each.id === jobId);
      const file = job?.files.find(
        (each) => stemOf(each.name) === stemOf(name) && each.format === 'pdf',
      );
      return job && file ? sampleRevision(job, file.name) : null;
    },
    copyText: async (text) => {
      await navigator.clipboard?.writeText(text).catch(() => {});
      return SAVED;
    },
    saveFile: async (name, text) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
      return { ok: true, saved: true };
    },
  };
}
