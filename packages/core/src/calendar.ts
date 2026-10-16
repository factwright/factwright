import { oneLine } from './answered.ts';
import { addDays, isIsoDate } from './dates.ts';
import { CALL_KIND_LABELS, CALL_MODE_LABELS, callLink, callPeople } from './progress.ts';
import type { Call, CallKind } from './tracker.ts';

/**
 * A call's calendar file, to save and open in any calendar app. It follows iCalendar (RFC 5545),
 * the format they all read. The app keeps times local, with no time zone, so the file gives them
 * as floating times, which a calendar shows at that time of day wherever it is.
 */

/** A time of day as the app keeps it: "HH:MM", from 00:00 to 23:59. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a value is a time of day as the app keeps it, "HH:MM". */
export const isClockTime = (value: unknown): value is string =>
  typeof value === 'string' && CLOCK.test(value);

/** When a call starts, by this computer's clock, or null for one with no time that reads. */
export function callStart(call: Pick<Call, 'onDate' | 'atTime'>): Date | null {
  if (!isIsoDate(call.onDate) || !isClockTime(call.atTime)) return null;
  const [year = 0, month = 1, day = 1] = call.onDate.split('-').map(Number);
  const [hours = 0, minutes = 0] = call.atTime.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

/** The longest a call can run in a calendar: a whole day. */
const MAX_MINUTES = 24 * 60;

/**
 * Text with what doesn't show taken out, as on one line, but with its line breaks kept: control
 * characters, and marks such as the right-to-left override, which could make it read one way and
 * say another.
 */
const cleanText = (text: string) =>
  text.replace(/\r\n?/g, '\n').split('\n').map(oneLine).join('\n');

/** Text as a calendar file writes it: backslashes, commas and semicolons escaped, lines as \n. */
const escaped = (text: string) =>
  cleanText(text)
    .replace(/[\\;,]/g, '\\$&')
    .replace(/\n/g, '\\n');

/** The most a line of a calendar file holds, in bytes, before it folds onto the next. */
const LINE_BYTES = 75;

/** How many bytes a character takes in UTF-8. */
function utf8Bytes(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
}

/**
 * A line folded as calendar files fold them: 75 bytes at most, with the rest on lines that each
 * start with a space. A character is never split, so every line stays valid UTF-8.
 */
function fold(line: string): string {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = utf8Bytes(char);
    if (bytes + size > LINE_BYTES) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** A moment in UTC, as a calendar file stamps it: "20261016T171500Z". */
const stampOf = (when: Date) =>
  `${pad(when.getUTCFullYear(), 4)}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}T${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`;

/** A day as a calendar file writes it: "20261020". */
const dayOf = (date: string) => date.replaceAll('-', '');

/**
 * A floating time, as a calendar file writes it, some minutes after a day and time: "20261020T140000",
 * on to the next day past midnight.
 */
function floatingTime(date: string, time: string, minutes = 0): string {
  const at = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)) + minutes,
    ),
  );
  return `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00`;
}

/**
 * What a call is called in a calendar or a reminder: "Panel interview with Northwind Labs". The
 * company's name is on one line, without characters that hide or flip text, as a posting's could
 * hold them.
 */
export function callTitle(company: string, kind: CallKind): string {
  const label = CALL_KIND_LABELS[kind];
  const name = oneLine(company);
  if (!name) return label;
  return kind === 'takehome' ? `${label} for ${name}` : `${label} with ${name}`;
}

/**
 * A calendar file for one call: its title, when and for how long (an hour when the user didn't
 * say), where, and in its notes the role, who it's with, how it happens and what it's about. A
 * call with no time is an all-day event. The file only adds an event: it names no attendees and
 * invites no one, so nobody on the call hears from the user's calendar. Null for a call whose
 * day doesn't read.
 */
export function callInvite(
  job: { company: string; role: string },
  call: Call,
  stamp: Date,
): string | null {
  if (!isIsoDate(call.onDate)) return null;
  const minutes = call.minutes && call.minutes <= MAX_MINUTES ? call.minutes : 60;
  const when = isClockTime(call.atTime)
    ? [
        `DTSTART:${floatingTime(call.onDate, call.atTime)}`,
        `DTEND:${floatingTime(call.onDate, call.atTime, minutes)}`,
      ]
    : [
        `DTSTART;VALUE=DATE:${dayOf(call.onDate)}`,
        `DTEND;VALUE=DATE:${dayOf(addDays(call.onDate, 1))}`,
      ];
  const link = callLink(call.place);
  // A calendar shows the meeting's link where it is, and what else the place says, such as a
  // passcode, in the notes.
  const location = link ? link.href : call.place;
  const facts = [
    job.role.trim() && `Role: ${job.role.trim()}`,
    call.people.length > 0 && `With ${callPeople(call.people)}`,
    call.mode && `How: ${CALL_MODE_LABELS[call.mode]}`,
    link && !link.alone && call.place && `Where: ${call.place}`,
  ]
    .filter(Boolean)
    .join('\n');
  const description = [facts, call.notes?.trim()].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Factwright//Factwright//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escaped(call.id)}@factwright.com`,
    `DTSTAMP:${stampOf(stamp)}`,
    ...when,
    `SUMMARY:${escaped(callTitle(job.company, call.kind))}`,
    location && `LOCATION:${escaped(location)}`,
    link && `URL:${link.href}`,
    description && `DESCRIPTION:${escaped(description)}`,
    `STATUS:${call.state === 'canceled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => Boolean(line));
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/**
 * A name for a call's calendar file, in letters, digits and plain punctuation, so every system
 * can save it: "Panel interview - Northwind Labs - 2026-10-20.ics".
 */
export function callInviteName(company: string, call: Pick<Call, 'kind' | 'onDate'>): string {
  const name = company
    .replaceAll('&', ' and ')
    .replace(/[^\w .()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  const day = isIsoDate(call.onDate) ? call.onDate : '';
  return `${[CALL_KIND_LABELS[call.kind], name, day].filter(Boolean).join(' - ')}.ics`;
}
