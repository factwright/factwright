import { oneLine } from './answered.ts';
import { isIsoDate } from './dates.ts';
import { callLink } from './progress.ts';
import type { CallPerson } from './tracker.ts';

/**
 * Reading the calendar invite a company sends for a call, the .ics file attached to its email,
 * for what the call form needs: when, for how long, where, and who it's with. The file comes
 * from anywhere, so it's read as plain text, in the window, with nothing it says ever run,
 * fetched or opened: each field is checked and cut to the form's limits, and the only link kept
 * is an https one.
 */

/** What an invite says about the call it sets up, in the call form's terms. */
export interface Invite {
  /** The day, as YYYY-MM-DD, in the user's time zone. */
  onDate: string;
  /** The time of day, as "HH:MM" in the user's time zone, or null for an all-day event. */
  atTime: string | null;
  /** How long it's booked for, in minutes, up to a day, when it says. */
  minutes: number | null;
  /** Where it is, an address or a number to call, or else the meeting's https link. */
  place: string | null;
  /** Whether the place is a video call's link, so the call is a video call. */
  online: boolean;
  /** Who it's with, by name: not the user, a room, or anyone who said no. */
  people: CallPerson[];
  /** Whether its time zone couldn't be read, so its time is as written, for the user to check. */
  zoneUnread: boolean;
  /** Whether it calls the meeting off rather than setting it up. */
  canceled: boolean;
}

export interface InviteOptions {
  /** The time zone to give its time in, such as "America/Chicago". This computer's by default. */
  timeZone?: string;
  /** The user, to leave out of who it's with, by name or email. */
  me?: { name?: string; email?: string };
  /** The longest place and name the call form takes, and the most people. */
  limits?: { place: number; person: number; people: number };
}

/** The most text an invite can hold to be read. A meeting's invite is a few thousand characters. */
export const MAX_INVITE_LENGTH = 5_000_000;

/** The most lines read, and the longest line kept, once folded lines are put back together. */
const MAX_LINES = 100_000;
const MAX_LINE = 100_000;

/** The most of any one property an event's read for, such as its attendees. */
const MAX_REPEATS = 500;

/** The most links looked at in an event's description, for its meeting's. */
const MAX_LINKS = 200;

const DEFAULT_LIMITS = { place: 500, person: 120, people: 12 };

/** Sites that host video calls, whose link in an invite is the meeting's. */
const MEETING_HOSTS = [
  'zoom.us',
  'zoom.com',
  'zoomgov.com',
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'gotomeeting.com',
  'goto.com',
  'whereby.com',
  'chime.aws',
  'bluejeans.com',
  'meet.jit.si',
  'skype.com',
  'around.co',
  'coderpad.io',
  'hirevue.com',
];

/** The properties of an event read for a call. Everything else in an invite is passed over. */
const READ = new Set([
  'DTSTART',
  'DTEND',
  'DURATION',
  'LOCATION',
  'URL',
  'DESCRIPTION',
  'ORGANIZER',
  'ATTENDEE',
  'STATUS',
  'CONFERENCE',
  'X-GOOGLE-CONFERENCE',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL',
]);

/** One line of an invite: its property's name, its parameters, and its value. */
interface Line {
  name: string;
  params: Map<string, string>;
  value: string;
}

/** A wall-clock time: a day and a time of day, in no time zone in particular. */
interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

/** One part of a time zone the invite defines: from when, at what offset, and how it recurs. */
interface Observance {
  start: Wall;
  /** Its offset from UTC, in minutes. */
  offset: number;
  rule: Map<string, string> | null;
}

/** What an invite holds that's read for a call. */
interface Parsed {
  method: string;
  /** The first event's properties, by name. */
  event: Map<string, Line[]> | null;
  /** The time zones it defines, by their IDs. */
  zones: Map<string, Observance[]>;
}

/**
 * The invite's lines, each folded line put back together: a line that starts with a space or a
 * tab goes on the one before. Up to a sensible number of lines, each cut to a sensible length.
 */
function unfold(text: string): string[] {
  const lines: string[] = [];
  let current: string | null = null;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (current !== null && (raw.startsWith(' ') || raw.startsWith('\t'))) {
      const room = MAX_LINE - current.length;
      if (room > 0) current += raw.slice(1, 1 + room);
      continue;
    }
    if (current !== null) lines.push(current);
    if (lines.length >= MAX_LINES) return lines;
    current = raw.slice(0, MAX_LINE);
  }
  if (current !== null) lines.push(current);
  return lines;
}

/** A parameter's value with RFC 6868's escapes read: ^' a quote, ^n a new line, ^^ a caret. */
const caretRead = (value: string) =>
  value.replace(/\^(['nN^])/g, (_, char: string) =>
    char === '^' ? '^' : char === "'" ? '"' : '\n',
  );

/** Text with its escapes read: \n a new line, and \\, \, and \; themselves. */
const unescaped = (value: string) =>
  value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));

const NAME = /^[A-Za-z0-9-]+/;
const PARAM_NAME = /^[A-Za-z0-9-]+$/;

/** One line, read into its name, parameters and value, or null when it doesn't read as one. */
function contentLine(line: string): Line | null {
  const name = NAME.exec(line)?.[0];
  if (!name) return null;
  const params = new Map<string, string>();
  let at = name.length;
  while (line[at] === ';') {
    const equals = line.indexOf('=', at);
    if (equals < 0) return null;
    const key = line.slice(at + 1, equals);
    if (!PARAM_NAME.test(key)) return null;
    at = equals + 1;
    const values: string[] = [];
    for (;;) {
      if (line[at] === '"') {
        const close = line.indexOf('"', at + 1);
        if (close < 0) return null;
        values.push(line.slice(at + 1, close));
        at = close + 1;
      } else {
        let end = at;
        while (end < line.length && line[end] !== ';' && line[end] !== ':' && line[end] !== ',') {
          // A quote belongs only around a whole value.
          if (line[end] === '"') return null;
          end++;
        }
        values.push(line.slice(at, end));
        at = end;
      }
      if (line[at] !== ',') break;
      at++;
    }
    const upper = key.toUpperCase();
    if (!params.has(upper)) params.set(upper, caretRead(values.join(',')));
  }
  if (line[at] !== ':') return null;
  return { name: name.toUpperCase(), params, value: line.slice(at + 1) };
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/** A moment as an invite writes it: a day alone, or a day and time, in UTC, a zone, or neither. */
interface Moment {
  wall: Wall;
  allDay: boolean;
  utc: boolean;
  zone: string | null;
}

/**
 * A day and time from an invite's line, or null when it doesn't read as a real one. An event's
 * is in the years a call can be. A time zone's rules start far earlier, often in 1601.
 */
function momentOf(line: Line | undefined, earliest = 1900): Moment | null {
  const match = line && DATE_TIME.exec(line.value.trim());
  if (!line || !match) return null;
  const [, y = '', m = '', d = '', hh, mm, , z] = match;
  if (!isIsoDate(`${y}-${m}-${d}`) || Number(y) < earliest || Number(y) > 2200) return null;
  const allDay = hh === undefined || line.params.get('VALUE')?.toUpperCase() === 'DATE';
  if (!allDay && (Number(hh) > 23 || Number(mm) > 59)) return null;
  return {
    wall: {
      y: Number(y),
      m: Number(m),
      d: Number(d),
      hh: allDay ? 0 : Number(hh),
      mm: allDay ? 0 : Number(mm),
    },
    allDay,
    utc: !allDay && z === 'Z',
    zone: allDay ? null : (line.params.get('TZID')?.trim() ?? null),
  };
}

const utcOf = (wall: Wall) => Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm);

/** Formatters for the time zones looked at, kept, as making one takes a while. */
const formats = new Map<string, Intl.DateTimeFormat | null>();

/** A formatter for a time zone by its IANA name, or null for a name the system doesn't know. */
function formatFor(zone: string): Intl.DateTimeFormat | null {
  if (formats.has(zone)) return formats.get(zone) ?? null;
  let format: Intl.DateTimeFormat | null;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
  } catch {
    format = null;
  }
  if (formats.size > 64) formats.clear();
  formats.set(zone, format);
  return format;
}

/** The wall-clock time a moment shows in a zone, or on this computer's clock without one. */
function wallAt(instant: number, format: Intl.DateTimeFormat | null): Wall {
  const when = new Date(instant);
  if (!format) {
    return {
      y: when.getFullYear(),
      m: when.getMonth() + 1,
      d: when.getDate(),
      hh: when.getHours(),
      mm: when.getMinutes(),
    };
  }
  const parts = format.formatToParts(when);
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? 0);
  return {
    y: part('year'),
    m: part('month'),
    d: part('day'),
    hh: part('hour'),
    mm: part('minute'),
  };
}

/** When a wall-clock time in a zone, by its IANA name, happens, or null for a zone not known. */
function instantInZone(zone: string, wall: Wall): number | null {
  const format = formatFor(zone);
  if (!format) return null;
  const target = utcOf(wall);
  let guess = target;
  // The zone's offset at a guess, applied, and tried again, settles in a step or two.
  for (let tries = 0; tries < 4; tries++) {
    const next = target - (utcOf(wallAt(guess, format)) - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The day of the month a yearly rule lands on, such as "the second Sunday of March", or null. */
function ruleDay(rule: Map<string, string>, year: number, month: number): number | null {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdayOf = (day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const byDay = /^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/.exec(rule.get('BYDAY') ?? '');
  const monthDays = (rule.get('BYMONTHDAY') ?? '')
    .split(',')
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= last);
  if (!byDay) return monthDays[0] ?? null;
  const weekday = WEEKDAYS.indexOf(byDay[2] ?? '');
  // Old rules give the week as days of the month, such as "BYMONTHDAY=8,9,10,11,12,13,14".
  if (monthDays.length > 0) return monthDays.find((day) => weekdayOf(day) === weekday) ?? null;
  const nth = Number(byDay[1] ?? 1);
  if (nth > 0) {
    const day = 1 + ((weekday - weekdayOf(1) + 7) % 7) + (nth - 1) * 7;
    return day <= last ? day : null;
  }
  const day = last - ((weekdayOf(last) - weekday + 7) % 7) + (nth + 1) * 7;
  return day >= 1 ? day : null;
}

/** When an observance starts in a year, by its own wall clock, or null when it isn't in force. */
function onsetIn(observance: Observance, year: number): number | null {
  const { start, rule } = observance;
  if (year < start.y) return null;
  // A part with no rule is in force from its start on, as Outlook writes a zone with no daylight
  // time, such as India's: one start in 1601, and no change since.
  if (!rule) return utcOf(start);
  if ((rule.get('FREQ') ?? '').toUpperCase() !== 'YEARLY') return null;
  const month = Number(rule.get('BYMONTH') ?? start.m);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const day = ruleDay(rule, year, month) ?? (month === start.m ? start.d : null);
  if (day === null) return null;
  const onset = Date.UTC(year, month - 1, day, start.hh, start.mm);
  const until = DATE_TIME.exec(rule.get('UNTIL') ?? '');
  if (until) {
    const [, y = '', m = '', d = '', hh = '23', mm = '59'] = until;
    if (onset > Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))) return null;
  }
  return onset;
}

/**
 * When a wall-clock time happens in a time zone the invite defines itself, as Outlook's invites
 * do with Windows' names for zones, such as "Eastern Standard Time": the offset of whichever of
 * its parts, standard time or daylight time, started last before it. Null when none fits.
 */
function instantByRules(observances: readonly Observance[] | undefined, wall: Wall): number | null {
  const at = utcOf(wall);
  let latest: { onset: number; offset: number } | null = null;
  for (const observance of observances ?? []) {
    for (const year of [wall.y - 1, wall.y]) {
      const onset = onsetIn(observance, year);
      if (onset !== null && onset <= at && (!latest || onset > latest.onset)) {
        latest = { onset, offset: observance.offset };
      }
    }
  }
  return latest ? at - latest.offset * 60_000 : null;
}

/** A zone's name as the system knows it, from forms invites use, such as Mozilla's long ones. */
function zoneNames(zone: string): string[] {
  const parts = zone.split('/').filter(Boolean);
  return [zone, parts.slice(-3).join('/'), parts.slice(-2).join('/')];
}

/**
 * When a moment happens, as a time in UTC, or as written for a floating time. Says too whether
 * it's floating or its zone couldn't be read.
 */
function instantOf(
  moment: Moment,
  zones: Map<string, Observance[]>,
): { at: number; floating: boolean; unread: boolean } {
  if (moment.utc) return { at: utcOf(moment.wall), floating: false, unread: false };
  if (!moment.zone) return { at: utcOf(moment.wall), floating: true, unread: false };
  // A zone's name is a few words at most. A long one is no zone.
  for (const name of moment.zone.length <= 100 ? zoneNames(moment.zone) : []) {
    const at = instantInZone(name, moment.wall);
    if (at !== null) return { at, floating: false, unread: false };
  }
  const byRules = instantByRules(zones.get(moment.zone), moment.wall);
  if (byRules !== null) return { at: byRules, floating: false, unread: false };
  return { at: utcOf(moment.wall), floating: true, unread: true };
}

/** A length as an invite gives it, such as "PT1H30M", in minutes, or null. */
function durationOf(value: string | undefined): number | null {
  const match =
    /^\+?P(?:(\d{1,6})W)?(?:(\d{1,6})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,6})M)?(?:(\d{1,6})S)?)?$/.exec(
      value?.trim() ?? '',
    );
  if (!match) return null;
  const [, weeks = '0', days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (
    Number(weeks) * 7 * 1440 +
    Number(days) * 1440 +
    Number(hours) * 60 +
    Number(minutes) +
    Math.round(Number(seconds) / 60)
  );
}

/** An offset from UTC as an invite gives it, such as "-0500", in minutes, or null. */
function offsetOf(value: string | undefined): number | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [, sign, hours = '0', minutes = '0'] = match;
  if (Number(hours) > 18 || Number(minutes) > 59) return null;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/** A rule's parts, such as FREQ and BYMONTH, by name. */
function ruleOf(value: string): Map<string, string> {
  const rule = new Map<string, string>();
  for (const part of value.slice(0, 500).split(';')) {
    const [key = '', ...rest] = part.split('=');
    if (key) rule.set(key.trim().toUpperCase(), rest.join('=').trim().toUpperCase());
  }
  return rule;
}

/**
 * What an invite holds that's read for a call: its method, its first event's properties, and
 * the time zones it defines. Lines inside an event's alarms, or anywhere else, are passed over.
 */
function parse(lines: readonly string[]): Parsed {
  const stack: string[] = [];
  const parsed: Parsed = { method: '', event: null, zones: new Map() };
  let inEvent = false;
  let zone: { id: string; observances: Observance[] } | null = null;
  let part: { start: Wall | null; offset: number | null; rule: Map<string, string> | null } | null =
    null;
  for (const raw of lines) {
    const line = contentLine(raw);
    if (!line) continue;
    const value = line.value.trim().toUpperCase();
    if (line.name === 'BEGIN') {
      if (stack.length >= 20) continue;
      const where = stack.at(-1);
      stack.push(value);
      if (value === 'VEVENT' && !parsed.event && (!where || where === 'VCALENDAR')) {
        parsed.event = new Map();
        inEvent = true;
      } else if (value === 'VTIMEZONE' && where === 'VCALENDAR') {
        zone = { id: '', observances: [] };
      } else if (zone && (value === 'STANDARD' || value === 'DAYLIGHT') && where === 'VTIMEZONE') {
        part = { start: null, offset: null, rule: null };
      }
      continue;
    }
    if (line.name === 'END') {
      if (stack.at(-1) !== value) continue;
      stack.pop();
      if (value === 'VEVENT' && inEvent) inEvent = false;
      if ((value === 'STANDARD' || value === 'DAYLIGHT') && zone && part) {
        if (part.start && part.offset !== null && zone.observances.length < 50) {
          zone.observances.push({ start: part.start, offset: part.offset, rule: part.rule });
        }
        part = null;
      }
      if (value === 'VTIMEZONE' && zone) {
        if (zone.id && parsed.zones.size < 20 && !parsed.zones.has(zone.id)) {
          parsed.zones.set(zone.id, zone.observances);
        }
        zone = null;
      }
      continue;
    }
    const where = stack.at(-1);
    if (where === 'VCALENDAR' && line.name === 'METHOD') parsed.method = value;
    else if (inEvent && where === 'VEVENT' && parsed.event && READ.has(line.name)) {
      const kept = parsed.event.get(line.name);
      if (!kept) parsed.event.set(line.name, [line]);
      else if (kept.length < MAX_REPEATS) kept.push(line);
    } else if (zone && where === 'VTIMEZONE' && line.name === 'TZID') {
      zone.id = line.value.trim();
    } else if (part && (where === 'STANDARD' || where === 'DAYLIGHT')) {
      if (line.name === 'DTSTART') part.start = momentOf(line, 1)?.wall ?? null;
      if (line.name === 'TZOFFSETTO') part.offset = offsetOf(line.value);
      if (line.name === 'RRULE') part.rule = ruleOf(line.value);
    }
  }
  return parsed;
}

/** Text on one line, cut to a length, without splitting a character in two. */
function fitted(text: string, max: number): string {
  let cut = oneLine(text).slice(0, max);
  // A character outside the basic plane is two halves, and a cut mustn't leave one.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trim();
}

/** Whether a link is on a site that hosts video calls. */
function onMeetingHost(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return MEETING_HOSTS.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

/** Every https link in some text, cleaned as the call card cleans a place's, up to a number. */
function linksIn(text: string): string[] {
  const links: string[] = [];
  let tried = 0;
  for (const match of text.matchAll(/https:\/\/[^\s<>"'()]+/gi)) {
    // Every one tried counts, as one that doesn't read costs as much to try.
    if (++tried > MAX_LINKS) break;
    const href = callLink(match[0])?.href;
    if (href) links.push(href);
  }
  return links;
}

/** Whether a link is a map's, the way to a place rather than a meeting. */
function isMapLink(href: string): boolean {
  try {
    const { hostname, pathname } = new URL(href);
    const host = hostname.toLowerCase().replace(/^www\./, '');
    const maps = pathname.startsWith('/maps');
    return (
      ['maps.app.goo.gl', 'maps.apple.com', 'waze.com', 'openstreetmap.org'].some(
        (site) => host === site || host.endsWith(`.${site}`),
      ) ||
      host.startsWith('maps.google.') ||
      (maps && (host.startsWith('google.') || host === 'goo.gl' || host === 'bing.com'))
    );
  } catch {
    return false;
  }
}

/**
 * The meeting's link, when the invite gives a video call's: the one it names as its conference,
 * or else one on a site that hosts video calls, from its link, location or description, or else
 * a location that's a link alone, and not a map's. Another link, such as a scheduling page or a
 * map, isn't a meeting's. Never a link longer than the place can hold, or anything but https.
 */
function meetingLink(event: Map<string, Line[]>, max: number): string | null {
  const text = (name: string) => (event.get(name) ?? []).map((line) => unescaped(line.value));
  const fits = (href: string) => href.length <= max;
  const named = [
    ...text('CONFERENCE'),
    ...text('X-GOOGLE-CONFERENCE'),
    ...text('X-MICROSOFT-SKYPETEAMSMEETINGURL'),
  ]
    .flatMap(linksIn)
    .find(fits);
  if (named) return named;
  const hosted = [...text('URL'), ...text('LOCATION'), ...text('DESCRIPTION')]
    .flatMap(linksIn)
    .find((href) => fits(href) && onMeetingHost(href));
  if (hosted) return hosted;
  const location = callLink(text('LOCATION')[0]?.trim() ?? null);
  return location?.alone && fits(location.href) && !isMapLink(location.href) ? location.href : null;
}

/**
 * Words that name how a video call happens, which a location can give in place of an address,
 * such as "Microsoft Teams Meeting" or "Zoom (link below)".
 */
const CALL_WORDS = new Set(
  'microsoft teams meeting meetings zoom google meet hangouts webex skype gotomeeting goto bluejeans whereby chime jitsi video call conference online virtual remote web room link links below above see details description invite tbd join the in on at via by and or a'.split(
    ' ',
  ),
);

/** Whether a place says where the call happens, rather than only naming a video call's service. */
const saysWhere = (place: string) =>
  place
    .split(/\s+/)
    .filter((token) => !token.includes('://'))
    .some((token) =>
      (token.match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => !CALL_WORDS.has(word.toLowerCase())),
    );

/** A number to call, as a tel: link gives it: digits and the marks a phone takes, and an extension. */
const PHONE = /^[+\d\s().,#*pPwW-]+(?:;ext=\d+)?$/;

/** The kinds of link, other than a web address, that a place's words can hold. */
const SCHEMES = /^\W*(?:javascript|vbscript|data|file|blob|mailto|tel|sms|callto):/i;

/**
 * Whether a word of a place is a link it leaves out: any but a video call's https link, which
 * can share the place with an address, as for a call with a room and a link to join from.
 */
function isOtherLink(word: string): boolean {
  if (!word.includes('://') && !SCHEMES.test(word)) return false;
  const link = callLink(word);
  return !link || !onMeetingHost(link.href);
}

/**
 * Where the event is, from its location: an address on one line, or a number to call, keeping no
 * link but a video call's.
 */
function placeOf(event: Map<string, Line[]>, max: number): string | null {
  const location = event.get('LOCATION')?.[0];
  if (!location) return null;
  // A place is a line or two, so a little more than it can hold is plenty to read it from.
  const text = unescaped(location.value)
    .slice(0, max * 4)
    .trim();
  const number = /^tel:(.+)$/i.exec(text)?.[1]?.trim();
  if (number) return PHONE.test(number) ? fitted(number, max) || null : null;
  // Each run of spaces becomes one, or a comma where it breaks a line, in one pass.
  const words = text
    .replace(/\s+/g, (run) => (run.includes('\n') ? ', ' : ' '))
    .split(' ')
    .filter((word) => !isOtherLink(word));
  const place = words.join(' ').replace(/^[\s,;]+|[\s,;]+$/g, '');
  return fitted(place, max) || null;
}

/** Whether a name is the user's own, ignoring case and spacing. */
const sameName = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Who the event's with, by the names it gives: its organizer, then its attendees, once each.
 * Rooms and other resources, anyone who isn't taking part or said no, the user, and anyone named
 * only by an email address are left out.
 */
function peopleOf(
  event: Map<string, Line[]>,
  me: InviteOptions['me'],
  limits: { person: number; people: number },
): CallPerson[] {
  const people: CallPerson[] = [];
  const named = new Set<string>();
  const myEmail = me?.email?.trim().toLowerCase();
  for (const line of [...(event.get('ORGANIZER') ?? []), ...(event.get('ATTENDEE') ?? [])]) {
    if (people.length >= limits.people) break;
    const kind = line.params.get('CUTYPE')?.toUpperCase();
    if (kind === 'ROOM' || kind === 'RESOURCE' || kind === 'GROUP') continue;
    if (line.params.get('ROLE')?.toUpperCase() === 'NON-PARTICIPANT') continue;
    if (line.params.get('PARTSTAT')?.toUpperCase() === 'DECLINED') continue;
    const email = (line.params.get('EMAIL') ?? line.value.replace(/^mailto:/i, ''))
      .trim()
      .toLowerCase();
    const name = fitted(line.params.get('CN') ?? '', limits.person);
    if (!name || name.includes('@')) continue;
    if ((myEmail && email === myEmail) || (me?.name?.trim() && sameName(name, me.name))) continue;
    if (named.has(name.toLowerCase())) continue;
    named.add(name.toLowerCase());
    people.push({ name, role: null });
  }
  return people;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * What an invite says about the call it sets up: its day and time in the user's time zone, how
 * long it's booked for, the meeting's https link or else its address or number, and who it's
 * with. Null for text that isn't an invite, or one with no day that reads.
 */
export function readInvite(text: string, options: InviteOptions = {}): Invite | null {
  if (typeof text !== 'string' || text.length > MAX_INVITE_LENGTH) return null;
  const limits = options.limits ?? DEFAULT_LIMITS;
  const { method, event, zones } = parse(unfold(text));
  const start = momentOf(event?.get('DTSTART')?.[0]);
  if (!event || !start) return null;
  const format = options.timeZone ? formatFor(options.timeZone) : null;
  const begins = instantOf(start, zones);
  // A floating time, or one in a zone that couldn't be read, is the time as written.
  const shown = start.allDay || begins.floating ? start.wall : wallAt(begins.at, format);
  let minutes: number | null = null;
  if (!start.allDay) {
    const end = momentOf(event.get('DTEND')?.[0]);
    const ends = end && !end.allDay ? instantOf(end, zones) : null;
    minutes =
      ends && ends.floating === begins.floating
        ? Math.round((ends.at - begins.at) / 60_000)
        : durationOf(event.get('DURATION')?.[0]?.value);
    if (minutes !== null && (minutes < 1 || minutes > 24 * 60)) minutes = null;
  }
  const link = meetingLink(event, limits.place);
  const where = placeOf(event, limits.place);
  // An address or a number to call says where the call happens, even beside a meeting's link, as
  // Google adds a Meet link to every event, an onsite one too. A location that only names the
  // video call's service, such as "Microsoft Teams Meeting", gives way to its link.
  const place = where && (saysWhere(where) || !link) ? where : link;
  const status = event.get('STATUS')?.[0]?.value.trim().toUpperCase();
  return {
    onDate: `${shown.y}-${pad(shown.m)}-${pad(shown.d)}`,
    atTime: start.allDay ? null : `${pad(shown.hh)}:${pad(shown.mm)}`,
    minutes,
    place,
    online: link !== null && place === link,
    people: peopleOf(event, options.me, limits),
    zoneUnread: begins.unread,
    canceled: method === 'CANCEL' || status === 'CANCELLED',
  };
}
