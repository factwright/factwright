import { describe, expect, it } from 'vitest';
import type { Job } from './jobs.ts';
import {
  callWhen,
  clockTime,
  dayFrom,
  fitTier,
  isInView,
  JOB_VIEWS,
  jobProgress,
  jobStats,
  nextStep,
  startingView,
  viewOf,
} from './progress.ts';
import { type Call, JOB_STATUSES } from './tracker.ts';

const TODAY = '2026-10-10';

function job(extra: Partial<Job> = {}): Job {
  return {
    id: 'acme--staff',
    company: 'Acme Robotics',
    companyKey: 'acme-robotics',
    role: 'Staff Engineer',
    link: null,
    links: [],
    location: null,
    pay: null,
    source: 'Fit check',
    fit: null,
    search: null,
    searches: [],
    folder: null,
    stage: 'new',
    firstSeen: '2026-10-01',
    lastActivity: '2026-10-01',
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    outreach: [],
    status: null,
    statusOn: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    manual: false,
    calls: [],
    statusLog: [],
    notes: [],
    docKinds: [],
    ...extra,
  };
}

function call(extra: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    kind: 'screen',
    onDate: '2026-10-12',
    atTime: null,
    state: 'scheduled',
    outcome: null,
    notes: null,
    ...extra,
  };
}

const progressOf = (extra: Partial<Job>) => jobProgress(job(extra), TODAY);

describe('times and days', () => {
  it.each([
    ['09:05', '9:05 AM'],
    ['00:30', '12:30 AM'],
    ['12:00', '12:00 PM'],
    ['23:45', '11:45 PM'],
  ])('reads %s as %s', (time, text) => {
    expect(clockTime(time)).toBe(text);
  });

  it.each([
    ['2026-10-10', 'today'],
    ['2026-10-11', 'tomorrow'],
    ['2026-10-09', 'yesterday'],
    ['2026-10-15', 'Thursday'],
    ['2026-10-17', 'Sat, Oct 17'],
    ['2026-10-01', 'Thu, Oct 1'],
  ])('reads %s as %s', (date, text) => {
    expect(dayFrom(date, TODAY)).toBe(text);
  });

  it('says when a call is', () => {
    expect(callWhen({ onDate: '2026-10-12', atTime: '10:30' }, TODAY)).toBe('Monday at 10:30 AM');
    expect(callWhen({ onDate: '2026-10-11', atTime: null }, TODAY)).toBe('tomorrow');
  });
});

describe('fitTier', () => {
  it('reads the fit check’s verdict first', () => {
    const fit = { verdict: 'Worth a look', score: 80, date: null };
    expect(fitTier({ fit, search: null }, 80)).toBe('worth');
  });

  it('then the job search’s tier, then the score alone', () => {
    const search = {
      source: 'HN',
      date: null,
      tier: 'good' as const,
      score: 90,
      detail: job().search?.detail ?? ({} as never),
    };
    expect(fitTier({ fit: null, search }, 90)).toBe('good');
    expect([75, 62, 50, 49].map((score) => fitTier({ fit: null, search: null }, score))).toEqual([
      'strong',
      'good',
      'worth',
      'long',
    ]);
    expect(fitTier({ fit: null, search: null }, null)).toBeNull();
  });
});

describe('jobProgress', () => {
  it('shows the skills’ stage until the user sets a status', () => {
    expect(progressOf({ stage: 'resume' }).status).toBe('resume');
    expect(progressOf({ stage: 'resume', status: 'applied' }).status).toBe('applied');
  });

  it('counts the furthest step reached, from history and calls too', () => {
    expect(
      progressOf({ status: 'passed', statusLog: [{ id: 'a', status: 'interview', at: TODAY }] })
        .reached,
    ).toBe(5);
    expect(progressOf({ calls: [call({ kind: 'offer' })] }).reached).toBe(6);
    expect(progressOf({ calls: [call({ kind: 'offer', state: 'canceled' })] }).reached).toBe(0);
    expect(progressOf({ status: 'rejected' }).reached).toBe(3);
  });

  it('takes the fit check’s score, then the job search’s', () => {
    const search = { source: 'HN', date: null, tier: null, score: 70, detail: {} as never };
    expect(progressOf({ search }).score).toBe(70);
    expect(progressOf({ search, fit: { verdict: 'Good', score: 74, date: null } }).score).toBe(74);
  });

  it('finds the latest activity and the next call', () => {
    const progress = progressOf({
      lastActivity: '2026-10-02',
      statusOn: '2026-10-05',
      calls: [
        call({ id: 'past', onDate: '2026-10-08', state: 'done' }),
        call({ id: 'next', onDate: '2026-10-20' }),
        call({ id: 'later', onDate: '2026-10-27' }),
      ],
    });
    expect(progress.lastActivity).toBe('2026-10-08');
    expect(progress.nextCall?.id).toBe('next');
    // A note counts as something happening, once its day has come.
    const noted = (on: string) =>
      progressOf({ lastActivity: '2026-10-02', notes: [{ id: 'n', on, text: 'Hi', at: on }] });
    expect(noted('2026-10-09').lastActivity).toBe('2026-10-09');
    expect(noted('2026-10-30').lastActivity).toBe('2026-10-02');
  });
});

describe('attention', () => {
  const attention = (extra: Partial<Job>) => progressOf(extra).attention;

  it('flags a next step that’s due or overdue', () => {
    expect(attention({ nextOn: '2026-10-09', nextAction: 'Email Sam' })).toEqual({
      level: 'urgent',
      text: 'Overdue: Email Sam',
    });
    expect(attention({ nextOn: TODAY })).toEqual({
      level: 'action',
      text: 'Due today: your next step',
    });
    expect(attention({ nextOn: '2026-10-09', status: 'rejected' })).toBeNull();
  });

  it('asks how a past call went, and mentions one coming up', () => {
    expect(attention({ calls: [call({ onDate: '2026-10-08', kind: 'technical' })] })).toEqual({
      level: 'action',
      text: 'How did the technical interview go?',
    });
    expect(attention({ calls: [call({ onDate: '2026-10-12', atTime: '10:30' })] })).toEqual({
      level: 'info',
      text: 'Recruiter screen Monday at 10:30 AM',
    });
    expect(attention({ calls: [call({ onDate: '2026-10-20' })] })).toBeNull();
  });

  it('nudges about applications with no answer', () => {
    expect(attention({ status: 'applied', statusOn: '2026-09-30' })?.text).toBe(
      'Applied 10 days ago. Follow up?',
    );
    expect(attention({ status: 'applied', appliedOn: '2026-09-09' })).toMatchObject({
      level: 'urgent',
      text: 'No reply in 31 days. Mark it “No reply”?',
    });
    expect(attention({ status: 'interview', statusOn: '2026-10-02' })?.text).toBe(
      'No update in 8 days',
    );
    expect(attention({ stage: 'resume', lastActivity: '2026-10-04' })?.text).toBe(
      'Resume ready for 6 days. Apply or pass?',
    );
    expect(attention({ status: 'applied', statusOn: '2026-10-05' })).toBeNull();
  });

  it('leaves archived jobs alone', () => {
    expect(attention({ archived: true, nextOn: '2026-10-01' })).toBeNull();
  });
});

describe('isInView', () => {
  it.each([
    ['new', ['review', 'all']],
    ['checked', ['apply', 'all']],
    ['resume', ['apply', 'all']],
    ['applied', ['applied', 'all']],
    ['screen', ['interviewing', 'all']],
    ['interview', ['interviewing', 'all']],
    ['offer', ['interviewing', 'all']],
    ['ghosted', ['closed', 'all']],
    ['accepted', ['closed', 'all']],
  ] as const)('puts %s in %j', (status, views) => {
    expect(JOB_VIEWS.filter((view) => isInView(view, status))).toEqual(views);
  });

  it('opens on the furthest view with jobs in it', () => {
    expect(startingView(['new', 'applied', 'screen', 'rejected'])).toBe('interviewing');
    expect(startingView(['new', 'resume', 'applied'])).toBe('applied');
    expect(startingView(['new', 'checked'])).toBe('apply');
    expect(startingView(['rejected'])).toBe('review');
    expect(startingView([])).toBe('review');
  });

  it('puts every status in one view besides all, and says which', () => {
    for (const status of JOB_STATUSES) {
      const views = JOB_VIEWS.filter((view) => view !== 'all' && isInView(view, status));
      expect(views).toEqual([viewOf(status)]);
    }
  });
});

describe('nextStep', () => {
  const step = (extra: Partial<Job>) =>
    nextStep(job(extra), jobProgress(job(extra), TODAY), TODAY)?.text;

  it('puts what needs the user first, then their own next step, then calls', () => {
    expect(step({ nextOn: '2026-10-09', nextAction: 'Email Sam' })).toBe('Overdue: Email Sam');
    expect(step({ nextAction: 'Email Sam', nextOn: '2026-10-13' })).toBe('Email Sam · Tuesday');
    expect(step({ calls: [call({ onDate: '2026-10-20', kind: 'panel' })] })).toBe(
      'Panel interview Tue, Oct 20',
    );
  });

  it('suggests what usually comes next', () => {
    expect(step({})).toBe('Run a fit check');
    expect(step({ company: 'Bluewave Staffing' })).toBe('Find the real employer');
    expect(step({ stage: 'checked' })).toBe('Tailor a resume');
    expect(step({ stage: 'resume', lastActivity: TODAY })).toBe('Ready to apply');
    expect(step({ status: 'applied', appliedOn: '2026-10-07', statusOn: '2026-10-07' })).toBe(
      'Applied 3 days ago',
    );
    expect(step({ status: 'screen', statusOn: TODAY })).toBe('Waiting to hear back');
    expect(step({ status: 'offer', statusOn: TODAY })).toBe('Decide on the offer');
  });

  it('suggests nothing for closed jobs, skips, or jobs without a role', () => {
    expect(step({ status: 'rejected' })).toBeUndefined();
    expect(step({ fit: { verdict: 'Skip', score: 30, date: null } })).toBeUndefined();
    expect(step({ role: '' })).toBeUndefined();
  });
});

describe('jobStats', () => {
  it('counts what’s in play, applied, heard back and needing the user', () => {
    const jobs = [
      job({ status: 'applied', appliedOn: '2026-10-08', statusOn: '2026-10-08' }),
      job({ status: 'screen', appliedOn: '2026-09-20', statusOn: TODAY, calls: [call()] }),
      job({ status: 'rejected', appliedOn: '2026-09-01' }),
      job({ status: 'ghosted', appliedOn: '2026-08-01' }),
      job({ stage: 'checked', nextOn: '2026-10-01' }),
      job(),
    ].map((each) => ({ job: each, progress: jobProgress(each, TODAY) }));
    expect(jobStats(jobs, TODAY)).toEqual({
      inPlay: 2,
      interviewing: 1,
      callsAhead: 1,
      applied: 4,
      appliedThisWeek: 1,
      heardBack: 2,
      needsYou: 2,
      urgent: 1,
    });
  });
});
