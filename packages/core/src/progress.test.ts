import { describe, expect, it } from 'vitest';
import type { Job } from './jobs.ts';
import {
  callLink,
  callWhen,
  clockTime,
  dayFrom,
  fitTier,
  isInView,
  isSetAside,
  JOB_VIEWS,
  jobProgress,
  jobStats,
  nextCallMoment,
  nextStep,
  STATUS_GROUPS,
  startingView,
  viewOf,
} from './progress.ts';
import type { JobFile } from './records.ts';
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
    kindFound: null,
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
    letters: [],
    outreach: [],
    status: null,
    statusOn: null,
    backOn: null,
    passReason: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    kind: null,
    manual: false,
    calls: [],
    callDocs: [],
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
    minutes: null,
    mode: null,
    place: null,
    people: [],
    state: 'scheduled',
    outcome: null,
    notes: null,
    debrief: null,
    ...extra,
  };
}

const progressOf = (extra: Partial<Job>) => jobProgress(job(extra), TODAY);

const pdf: JobFile = {
  path: 'applications/acme/resume.pdf',
  name: 'resume.pdf',
  format: 'pdf',
  size: 1000,
  modified: '2026-10-04T10:00:00.000Z',
};

describe('callLink', () => {
  it('finds the https link in a call’s place, keeping what else it says to read', () => {
    expect(callLink('https://meet.example.com/acme')).toEqual({
      href: 'https://meet.example.com/acme',
      shown: 'meet.example.com/acme',
      alone: true,
    });
    expect(callLink('https://zoom.us/j/8812345678 passcode 4321')).toEqual({
      href: 'https://zoom.us/j/8812345678',
      shown: 'zoom.us/j/8812345678',
      alone: false,
    });
    expect(callLink('Join (https://zoom.us/j/88?pwd=x1).')).toMatchObject({
      href: 'https://zoom.us/j/88?pwd=x1',
      shown: 'zoom.us/j/88',
      alone: false,
    });
    expect(callLink('https://meet.example.com')).toMatchObject({ shown: 'meet.example.com' });
    // However much punctuation follows it, quickly.
    expect(callLink(`https://meet.example.com/x${'!'.repeat(50_000)}a`)?.shown).toMatch(
      /^meet\.example\.com\/x!+a$/,
    );
    expect(callLink(`See https://meet.example.com/x${'!'.repeat(50_000)}`)?.href).toBe(
      'https://meet.example.com/x',
    );
  });

  it('opens nothing but https, and nothing with a name and password in it', () => {
    for (const place of [
      null,
      '',
      '1 Main St, Chicago',
      '+1 312 555 0100',
      'http://meet.example.com/acme',
      'javascript:alert(1)',
      'https://zoom.us@evil.example/j/1',
      // Built in two parts, so a secret scanner doesn't take a made-up example for a real one.
      ['https://user', 'secret@meet.example.com/x'].join(':'),
    ]) {
      expect(callLink(place)).toBeNull();
    }
  });
});

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
  it('shows what Claude’s work did until the user sets a status', () => {
    expect(progressOf({}).status).toBe('new');
    expect(progressOf({ stage: 'review' }).status).toBe('review');
    expect(progressOf({ stage: 'review', status: 'apply' }).status).toBe('apply');
    expect(progressOf({ stage: 'review', status: 'applied' }).status).toBe('applied');
  });

  it('brings a job set aside back on its day', () => {
    const later = (backOn: string | null) => progressOf({ status: 'later', backOn });
    expect(later(null)).toMatchObject({ status: 'later', backFromLater: false });
    expect(later('2026-10-11').backFromLater).toBe(false);
    expect(later(TODAY).backFromLater).toBe(true);
    expect(later('2026-10-01').backFromLater).toBe(true);
    expect(isSetAside(later('2026-10-11'))).toBe(true);
    expect(isSetAside(later(TODAY))).toBe(false);
    // A date kept from before means nothing once the job moved on.
    expect(progressOf({ status: 'review', backOn: '2026-10-01' }).backFromLater).toBe(false);
    // Coming back counts as something happening, so it sorts with the latest.
    expect(later('2026-10-09').lastActivity).toBe('2026-10-09');
    expect(later('2026-10-11').lastActivity).toBe('2026-10-01');
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
    expect(attention({ calls: [call({ onDate: '2026-10-13', atTime: '10:30' })] })).toEqual({
      level: 'info',
      text: 'Recruiter screen Tuesday at 10:30 AM',
    });
    expect(attention({ calls: [call({ onDate: '2026-10-20' })] })).toBeNull();
  });

  it('with the time of day, lets a call today go once it starts, and asks how it went once it’s over', () => {
    const today = call({ id: 'today', kind: 'panel', onDate: TODAY, atTime: '09:00', minutes: 90 });
    const later = call({ id: 'later', kind: 'final', onDate: '2026-10-20', atTime: '14:00' });
    const at = (clock: string) => jobProgress(job({ calls: [today, later] }), TODAY, clock);
    expect(at('08:30')).toMatchObject({
      nextCall: { id: 'today' },
      attention: { level: 'action', text: 'Prep for the panel interview today at 9:00 AM' },
    });
    // Underway, it's no longer the next call, and it's too soon to ask how it went.
    expect(at('09:30')).toMatchObject({ nextCall: { id: 'later' }, attention: null });
    // Over, after its hour and a half.
    expect(at('10:30').attention).toEqual({
      level: 'action',
      text: 'How did the panel interview go?',
    });
    // Without the time of day, a call today is next all day, as before.
    expect(jobProgress(job({ calls: [today, later] }), TODAY).nextCall?.id).toBe('today');
  });

  it('says when the time of day next matters to the calls today', () => {
    const calls = [
      call({ id: 'a', onDate: TODAY, atTime: '09:00', minutes: 30 }),
      call({ id: 'b', onDate: TODAY, atTime: '13:00' }),
      call({ id: 'c', onDate: TODAY }),
      call({ id: 'd', onDate: '2026-10-11', atTime: '08:00' }),
      call({ id: 'e', onDate: TODAY, atTime: '23:30', state: 'canceled' }),
    ];
    expect(nextCallMoment(calls, TODAY, '08:00')).toBe('09:00');
    expect(nextCallMoment(calls, TODAY, '09:00')).toBe('09:30');
    expect(nextCallMoment(calls, TODAY, '09:30')).toBe('13:00');
    expect(nextCallMoment(calls, TODAY, '13:30')).toBe('14:00');
    expect(nextCallMoment(calls, TODAY, '14:00')).toBeNull();
  });

  it('asks the user to prep for a call two days out that has no prep sheet yet', () => {
    const soon = call({ id: 'soon', kind: 'panel', onDate: '2026-10-12', atTime: '14:00' });
    expect(attention({ calls: [soon] })).toEqual({
      level: 'action',
      text: 'Prep for the panel interview Monday at 2:00 PM',
    });
    const prep = {
      callId: 'soon',
      kind: 'prep' as const,
      path: 'calls/acme--staff/soon/prep.md',
      modified: '2026-10-09T12:00:00.000Z',
    };
    expect(attention({ calls: [soon], callDocs: [prep] })).toEqual({
      level: 'info',
      text: 'Panel interview Monday at 2:00 PM',
    });
    // Thank-you notes from an earlier call aren't prep for this one.
    expect(attention({ calls: [soon], callDocs: [{ ...prep, kind: 'thanks' }] })?.level).toBe(
      'action',
    );
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
    expect(attention({ status: 'applied', statusOn: '2026-10-05' })).toBeNull();
  });

  it('nudges about a resume that’s waiting, and a job back from later', () => {
    const resume: Partial<Job> = { stage: 'review', files: [pdf], lastActivity: '2026-10-04' };
    expect(attention(resume)).toEqual({
      level: 'info',
      text: 'Resume ready for 6 days. Apply or pass?',
    });
    expect(attention({ ...resume, status: 'apply', statusOn: '2026-10-03' })?.text).toBe(
      'Resume ready for 6 days. Apply?',
    );
    // Marking it To apply is something happening.
    expect(attention({ ...resume, status: 'apply', statusOn: '2026-10-08' })).toBeNull();
    expect(attention({ stage: 'review', lastActivity: '2026-10-01' })).toBeNull();
    expect(attention({ status: 'later', backOn: '2026-10-10' })).toEqual({
      level: 'action',
      text: 'Back from Later. Apply or pass?',
    });
    expect(attention({ status: 'later', backOn: '2026-10-11' })).toBeNull();
  });

  it('leaves archived jobs alone', () => {
    expect(attention({ archived: true, nextOn: '2026-10-01' })).toBeNull();
  });
});

describe('isInView', () => {
  it.each([
    ['new', ['new', 'all']],
    ['review', ['review', 'all']],
    ['later', ['review', 'all']],
    ['apply', ['apply', 'all']],
    ['applied', ['applied', 'all']],
    ['screen', ['interviewing', 'all']],
    ['interview', ['interviewing', 'all']],
    ['offer', ['interviewing', 'all']],
    ['ghosted', ['closed', 'all']],
    ['accepted', ['closed', 'all']],
    ['passed', ['closed', 'all']],
    ['role-closed', ['closed', 'all']],
  ] as const)('puts %s in %j', (status, views) => {
    expect(JOB_VIEWS.filter((view) => isInView(view, status))).toEqual(views);
  });

  it('opens on the furthest view with jobs in it', () => {
    expect(startingView(['new', 'applied', 'screen', 'rejected'])).toBe('interviewing');
    expect(startingView(['new', 'apply', 'applied'])).toBe('applied');
    expect(startingView(['new', 'review', 'apply'])).toBe('apply');
    expect(startingView(['new', 'later'])).toBe('review');
    expect(startingView(['rejected'])).toBe('closed');
    expect(startingView(['rejected', 'new'])).toBe('new');
    expect(startingView([])).toBe('new');
  });

  it('groups every status once, in the order of the list of statuses', () => {
    expect(STATUS_GROUPS.map((group) => group.label)).toEqual([
      'Before applying',
      'After applying',
      'Closed',
    ]);
    expect(STATUS_GROUPS.flatMap((group) => group.statuses)).toEqual([...JOB_STATUSES]);
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
    expect(step({ status: 'applied', appliedOn: '2026-10-07', statusOn: '2026-10-07' })).toBe(
      'Applied 3 days ago',
    );
    expect(step({ status: 'screen', statusOn: TODAY })).toBe('Waiting to hear back');
    expect(step({ status: 'offer', statusOn: TODAY })).toBe('Decide on the offer');
  });

  it('says what’s left to decide before applying', () => {
    const fit = (verdict: string) => ({ verdict, score: 70, date: null });
    // Claude's work takes a job to To review. Only the user takes it further.
    expect(step({ stage: 'review' })).toBe('Run a fit check');
    expect(step({ stage: 'review', fit: fit('Good') })).toBe('Apply or pass?');
    expect(step({ stage: 'review', fit: fit('Skip: hybrid in Austin') })).toBe(
      'Fit check says skip. Pass?',
    );
    expect(step({ stage: 'review', files: [pdf], lastActivity: TODAY })).toBe(
      'Resume ready. Apply or pass?',
    );
    expect(step({ status: 'apply', statusOn: TODAY })).toBe('Tailor a resume');
    expect(step({ status: 'apply', statusOn: TODAY, files: [pdf] })).toBe('Ready to apply');
    // A posting that asks for a cover letter gets one too.
    const asks = {
      status: 'apply' as const,
      statusOn: TODAY,
      apply: '- **Alert:** Attach a cover letter.',
    };
    expect(step(asks)).toBe('Tailor a resume and a cover letter');
    expect(step({ ...asks, files: [pdf] })).toBe('The posting asks for a cover letter');
    expect(step({ ...asks, files: [pdf], letters: [pdf] })).toBe('Ready to apply');
    expect(step({ ...asks, files: [pdf], apply: 'No cover letter needed.' })).toBe(
      'Ready to apply',
    );
    expect(step({ status: 'later', backOn: '2026-10-15' })).toBe('Back Thursday');
    expect(step({ status: 'later', backOn: '2026-10-11' })).toBe('Back tomorrow');
    expect(step({ status: 'later' })).toBeUndefined();
    expect(step({ status: 'later', backOn: TODAY })).toBe('Back from Later. Apply or pass?');
  });

  it('suggests nothing for closed jobs, skips, or jobs without a role', () => {
    expect(step({ status: 'rejected' })).toBeUndefined();
    expect(step({ status: 'role-closed' })).toBeUndefined();
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
      job({ stage: 'review', nextOn: '2026-10-01' }),
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
