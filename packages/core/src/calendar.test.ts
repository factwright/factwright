import { describe, expect, it } from 'vitest';
import { callInvite, callInviteName, callTitle, isClockTime } from './calendar.ts';
import { readInvite } from './invite.ts';
import type { Call } from './tracker.ts';

const JOB = { company: 'Northwind Labs', role: 'Senior Software Engineer, Platform' };
const STAMP = new Date('2026-10-16T17:15:00Z');

function call(extra: Partial<Call> = {}): Call {
  return {
    id: 'northwind-panel',
    kind: 'panel',
    onDate: '2026-10-20',
    atTime: '14:00',
    minutes: 90,
    mode: 'video',
    place: 'https://meet.example.com/northwind-panel',
    people: [
      { name: 'Dana Lee', role: 'Hiring manager' },
      { name: 'Sam Ortiz', role: 'Staff engineer' },
    ],
    state: 'scheduled',
    outcome: null,
    notes: 'System design and team fit. Bring the cost-tooling numbers.',
    debrief: null,
    ...extra,
  };
}

/** A calendar file's lines, each folded line put back together. */
const linesOf = (ics: string | null) =>
  (ics ?? '')
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter(Boolean);

/** One property's value, from a file's lines. */
const property = (ics: string | null, name: string) =>
  linesOf(ics)
    .find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`))
    ?.replace(/^[^:]*:/, '');

/** How many bytes some text takes in UTF-8. A lone half of a character can't be counted. */
const bytes = (text: string) => encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '.').length;

describe('callInvite', () => {
  it('writes a call as an event at its own time of day, floating, for its length', () => {
    const ics = callInvite(JOB, call(), STAMP);
    expect(ics?.endsWith('\r\n')).toBe(true);
    expect(linesOf(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Factwright//Factwright//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:northwind-panel@factwright.com',
      'DTSTAMP:20261016T171500Z',
      'DTSTART:20261020T140000',
      'DTEND:20261020T153000',
      'SUMMARY:Panel interview with Northwind Labs',
      'LOCATION:https://meet.example.com/northwind-panel',
      'URL:https://meet.example.com/northwind-panel',
      'DESCRIPTION:Role: Senior Software Engineer\\, Platform\\nWith Dana Lee (Hiring manager) and Sam Ortiz (Staff engineer)\\nHow: Video\\n\\nSystem design and team fit. Bring the cost-tooling numbers.',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
  });

  it('books an hour when the length isn’t known, and runs on past midnight', () => {
    expect(property(callInvite(JOB, call({ minutes: null }), STAMP), 'DTEND')).toBe(
      '20261020T150000',
    );
    const late = callInvite(JOB, call({ onDate: '2026-12-31', atTime: '23:30' }), STAMP);
    expect(property(late, 'DTSTART')).toBe('20261231T233000');
    expect(property(late, 'DTEND')).toBe('20270101T010000');
    // A length no call has, such as from another device, is an hour too.
    expect(property(callInvite(JOB, call({ minutes: 99_999 }), STAMP), 'DTEND')).toBe(
      '20261020T150000',
    );
  });

  it('makes a call with no time an all-day event', () => {
    const ics = callInvite(JOB, call({ atTime: null, onDate: '2026-12-31' }), STAMP);
    expect(linesOf(ics)).toContain('DTSTART;VALUE=DATE:20261231');
    expect(linesOf(ics)).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('invites no one: the people on the call are only named in its notes', () => {
    const ics = callInvite(JOB, call(), STAMP);
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|METHOD:REQUEST/);
    expect(property(ics, 'DESCRIPTION')).toContain('With Dana Lee (Hiring manager)');
  });

  it('puts the meeting’s link where it is, and what else the place says in the notes', () => {
    const ics = callInvite(
      JOB,
      call({ place: 'https://zoom.us/j/8812345678 passcode 4321' }),
      STAMP,
    );
    expect(property(ics, 'LOCATION')).toBe('https://zoom.us/j/8812345678');
    expect(property(ics, 'URL')).toBe('https://zoom.us/j/8812345678');
    expect(property(ics, 'DESCRIPTION')).toContain(
      'Where: https://zoom.us/j/8812345678 passcode 4321',
    );
  });

  it('writes an address or a number as the place, and never a link that isn’t https', () => {
    const onsite = callInvite(
      JOB,
      call({ mode: 'onsite', place: '500 Market St, San Francisco' }),
      STAMP,
    );
    expect(property(onsite, 'LOCATION')).toBe('500 Market St\\, San Francisco');
    expect(property(onsite, 'URL')).toBeUndefined();
    const sly = callInvite(JOB, call({ place: 'javascript:alert(1)' }), STAMP);
    expect(property(sly, 'URL')).toBeUndefined();
    expect(property(sly, 'LOCATION')).toBe('javascript:alert(1)');
    const plain = callInvite(JOB, call({ place: 'http://zoom.us/j/1' }), STAMP);
    expect(property(plain, 'URL')).toBeUndefined();
    const none = callInvite(JOB, call({ place: null, people: [], notes: null, mode: null }), STAMP);
    expect(property(none, 'LOCATION')).toBeUndefined();
    expect(property(none, 'DESCRIPTION')).toBe('Role: Senior Software Engineer\\, Platform');
  });

  it('escapes what would break the file, so nothing in a call can add a line of its own', () => {
    const ics = callInvite(
      { company: 'Smith, Jones; Co \\ Partners', role: '' },
      call({
        id: 'x\r\nATTENDEE:mailto:a@example.com',
        place: 'Suite 5\r\nATTENDEE:mailto:evil@example.com\r\nEND:VEVENT\rBEGIN:VEVENT',
        notes: 'Line one\nLine two\r\nURL:https://evil.example',
      }),
      STAMP,
    );
    const lines = linesOf(ics);
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('ATTENDEE'))).toBe(false);
    expect(lines.filter((line) => line.startsWith('URL'))).toEqual([]);
    expect(property(ics, 'SUMMARY')).toBe(
      'Panel interview with Smith\\, Jones\\; Co \\\\ Partners',
    );
    expect(property(ics, 'LOCATION')).toBe(
      'Suite 5\\nATTENDEE:mailto:evil@example.com\\nEND:VEVENT\\nBEGIN:VEVENT',
    );
    expect(property(ics, 'UID')).toBe('x\\nATTENDEE:mailto:a@example.com@factwright.com');
  });

  it('leaves out characters that hide or flip text, such as the right-to-left override', () => {
    const ics = callInvite(
      JOB,
      call({
        people: [{ name: 'Dana\u202e Lee\u0000\u200b', role: null }],
        notes: '\u2066Bring\u0007 notes\u2069',
      }),
      STAMP,
    );
    expect(property(ics, 'DESCRIPTION')).toContain('With Dana Lee\\n');
    expect(property(ics, 'DESCRIPTION')).toContain('\\n\\nBring notes');
    const hidden = [...(ics ?? '')].filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        (code < 0x20 && code !== 0x0a && code !== 0x0d) ||
        [0x202e, 0x2066, 0x2069, 0x200b].includes(code)
      );
    });
    expect(hidden).toEqual([]);
  });

  it('folds long lines at 75 bytes without ever splitting a character', () => {
    const notes = `${'Bring the deck 📊 and the numbers. 会议记录。'.repeat(20)}é`;
    const ics = callInvite(JOB, call({ notes }), STAMP) ?? '';
    const physical = ics.split('\r\n').filter(Boolean);
    expect(physical.length).toBeGreaterThan(linesOf(ics).length);
    for (const line of physical) expect(bytes(line)).toBeLessThanOrEqual(75);
    expect(property(ics, 'DESCRIPTION')?.endsWith(`${notes.replace(/,/g, '\\,')}`)).toBe(true);
  });

  it('marks a canceled call as canceled', () => {
    expect(property(callInvite(JOB, call({ state: 'canceled' }), STAMP), 'STATUS')).toBe(
      'CANCELLED',
    );
  });

  it('reads back as the same call', () => {
    const ics = callInvite(JOB, call(), STAMP) ?? '';
    expect(readInvite(ics)).toEqual({
      onDate: '2026-10-20',
      atTime: '14:00',
      minutes: 90,
      place: 'https://meet.example.com/northwind-panel',
      online: true,
      people: [],
      zoneUnread: false,
      canceled: false,
    });
  });

  it('writes nothing for a call whose day doesn’t read', () => {
    expect(callInvite(JOB, call({ onDate: 'soon' }), STAMP)).toBeNull();
    expect(callInvite(JOB, call({ onDate: '2026-02-30' }), STAMP)).toBeNull();
    // A time that doesn't read makes it all day.
    expect(linesOf(callInvite(JOB, call({ atTime: '25:00' }), STAMP))).toContain(
      'DTSTART;VALUE=DATE:20261020',
    );
  });
});

describe('callTitle', () => {
  it('names the call and the company, with a take-home for one', () => {
    expect(callTitle('Northwind Labs', 'panel')).toBe('Panel interview with Northwind Labs');
    expect(callTitle('Northwind Labs', 'takehome')).toBe('Take-home for Northwind Labs');
    expect(callTitle('Northwind Labs', 'other')).toBe('Call with Northwind Labs');
    expect(callTitle('  ', 'screen')).toBe('Recruiter screen');
  });
});

describe('callInviteName', () => {
  it('names the file for the call, the company and the day, in plain characters', () => {
    expect(callInviteName('Northwind Labs', call())).toBe(
      'Panel interview - Northwind Labs - 2026-10-20.ics',
    );
    expect(callInviteName('Harbor & Pine', call({ kind: 'screen' }))).toBe(
      'Recruiter screen - Harbor and Pine - 2026-10-20.ics',
    );
    expect(callInviteName('../../etc/passwd: "x"?', call({ kind: 'takehome' }))).toBe(
      'Take-home - .. .. etc passwd x - 2026-10-20.ics',
    );
    expect(callInviteName('株式会社', call({ kind: 'other' }))).toBe('Call - 2026-10-20.ics');
    expect(callInviteName('A'.repeat(300), call()).length).toBeLessThanOrEqual(100);
    expect(callInviteName('Acme', call({ onDate: 'soon' }))).toBe('Panel interview - Acme.ics');
  });
});

describe('isClockTime', () => {
  it('takes a time of day as the app keeps it, and nothing else', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    for (const value of ['24:00', '9:30', '12:60', '12:30:00', '', null, 1230]) {
      expect(isClockTime(value)).toBe(false);
    }
  });
});
