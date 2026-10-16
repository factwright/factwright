import { describe, expect, it } from 'vitest';
import { MAX_INVITE_LENGTH, readInvite } from './invite.ts';

/** The time zone the tests read invites in, as if the computer were in Chicago. */
const CHICAGO = { timeZone: 'America/Chicago' };

/** An invite's lines, joined as calendar files join them. */
const ics = (...lines: string[]) => `${lines.join('\r\n')}\r\n`;

/** An invite with one event of these lines. */
const event = (...lines: string[]) =>
  ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR');

/** As Google Calendar sends one: times in UTC, a Meet link, and everyone invited. */
const GOOGLE = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261020T190000Z',
  'DTEND:20261020T194500Z',
  'DTSTAMP:20261016T150000Z',
  'ORGANIZER;CN=Priya Shah:mailto:priya@northwind.example',
  'UID:7kukuqrfedlm2f9mqm8h0ifirr@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Priya Shah;X-NUM-GUE',
  ' STS=0:mailto:priya@northwind.example',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=steve@example.c',
  ' om;X-NUM-GUESTS=0:mailto:steve@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Dana Lee;X-NUM-',
  ' GUESTS=0:mailto:dana@northwind.example',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'DESCRIPTION:Recruiter screen for the platform role.\\n\\nLearn more about Meet at: https://',
  ' support.google.com/a/users/answer/9282720\\n\\nJoin with Google Meet: https://meet.goog',
  ' le.com/abc-defg-hij',
  'LOCATION:',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Steve Hillyer <> Northwind Labs: Recruiter screen',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'END:VCALENDAR',
);

/** Outlook's time zone for the US East, by its Windows name, with its own rules. */
const EASTERN = [
  'BEGIN:VTIMEZONE',
  'TZID:Eastern Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

const TEAMS_LINK =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjE5ZDk3YjEtYzQ1Ny00%40thread.v2/0?context=%7b%22Tid%22%3a%2272f988bf%22%7d';

/** As Outlook sends one for a Teams call: a Windows time zone, a room, and someone who said no. */
function outlook(start = '20261020T150000', end = '20261020T163000') {
  return ics(
    'BEGIN:VCALENDAR',
    'METHOD:REQUEST',
    'PRODID:Microsoft Exchange Server 2010',
    'VERSION:2.0',
    ...EASTERN,
    'BEGIN:VEVENT',
    'ORGANIZER;CN="Lee, Dana":mailto:dana.lee@northwind.example',
    'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Steve Hillyer:mailto:s',
    ' teve@example.com',
    'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Sam Ortiz:mailto:sam@n',
    ' orthwind.example',
    'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED;RSVP=TRUE;CN=Ana Ruiz:mailto:ana@northwi',
    ' nd.example',
    'ATTENDEE;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT;RSVP=TRUE;CN=Conf Room 4B:mailto:room4b@n',
    ' orthwind.example',
    'DESCRIPTION;LANGUAGE=en-US:____\\n Microsoft Teams Need help? <https://aka.ms/JoinTeam',
    ` sMeeting?omkt=en-US>\\nJoin the meeting now <${TEAMS_LINK}>\\nMeeting ID: 123 456 789\\n`,
    'UID:040000008200E00074C5B7101A82E00800000000',
    'SUMMARY;LANGUAGE=en-US:Panel interview: Steve Hillyer',
    `DTSTART;TZID=Eastern Standard Time:${start}`,
    `DTEND;TZID=Eastern Standard Time:${end}`,
    'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
    `X-MICROSOFT-SKYPETEAMSMEETINGURL:${TEAMS_LINK}`,
    'END:VEVENT',
    'END:VCALENDAR',
  );
}

/** As Zoom saves one: a zone by its name, the link as the location, and an alarm of its own. */
const ZOOM = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//zoom.us//iCalendar Event//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  'DTSTAMP:20261016T150000Z',
  'DTSTART;TZID=America/Los_Angeles:20261020T120000',
  'DTEND;TZID=America/Los_Angeles:20261020T130000',
  'SUMMARY:Technical interview',
  'UID:20261016T150000Z-81234567890@fe80:0:0:0:0:0:0:1',
  'DESCRIPTION:Priya Shah is inviting you to a scheduled Zoom meeting.\\n\\nJoin Zoom Meeting',
  ' \\nhttps://us02web.zoom.us/j/81234567890?pwd=abc123\\n\\nMeeting ID: 812 3456 7890\\nPas',
  ' scode: 4321\\n',
  'LOCATION:https://us02web.zoom.us/j/81234567890?pwd=abc123',
  'BEGIN:VALARM',
  'TRIGGER:-PT10M',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder https://evil.example/ignore-me',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
);

describe('readInvite', () => {
  it('reads a Google Calendar invite in the user’s own time zone, with its Meet link', () => {
    expect(readInvite(GOOGLE, CHICAGO)).toEqual({
      onDate: '2026-10-20',
      atTime: '14:00',
      minutes: 45,
      place: 'https://meet.google.com/abc-defg-hij',
      online: true,
      // The user, named only by their email, isn't someone the call is with.
      people: [
        { name: 'Priya Shah', role: null },
        { name: 'Dana Lee', role: null },
      ],
      zoneUnread: false,
      canceled: false,
    });
    // Two hours later in New York.
    expect(readInvite(GOOGLE, { timeZone: 'America/New_York' })?.atTime).toBe('15:00');
  });

  it('reads an Outlook invite by its own rules for the time zone, in summer and in winter', () => {
    const me = { name: 'steve  hillyer', email: 'nobody@example.com' };
    expect(readInvite(outlook(), { ...CHICAGO, me })).toEqual({
      onDate: '2026-10-20',
      atTime: '14:00',
      minutes: 90,
      place: TEAMS_LINK,
      online: true,
      // Not the user, the room, or Ana, who said no.
      people: [
        { name: 'Lee, Dana', role: null },
        { name: 'Sam Ortiz', role: null },
      ],
      zoneUnread: false,
      canceled: false,
    });
    const winter = readInvite(outlook('20270115T150000', '20270115T153000'), CHICAGO);
    expect(winter).toMatchObject({ onDate: '2027-01-15', atTime: '14:00', minutes: 30 });
    // In Tokyo it's the next morning.
    const tokyo = readInvite(outlook(), { timeZone: 'Asia/Tokyo' });
    expect(tokyo).toMatchObject({ onDate: '2026-10-21', atTime: '04:00' });
  });

  it('follows rules for a zone whose summer spans the new year', () => {
    const sydney = ics(
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'TZID:AUS Eastern Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16010101T030000',
      'TZOFFSETTO:+1000',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010101T020000',
      'TZOFFSETTO:+1100',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=10',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'DTSTART;TZID=AUS Eastern Standard Time:20270115T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20990101T000000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    // 9:00 in Sydney's summer is 22:00 UTC the day before: 4:00 PM in Chicago.
    expect(readInvite(sydney, CHICAGO)).toMatchObject({ onDate: '2027-01-14', atTime: '16:00' });
  });

  it('reads a Zoom invite, and nothing from the alarm inside it', () => {
    expect(readInvite(ZOOM, CHICAGO)).toEqual({
      onDate: '2026-10-20',
      atTime: '14:00',
      minutes: 60,
      place: 'https://us02web.zoom.us/j/81234567890?pwd=abc123',
      online: true,
      people: [],
      zoneUnread: false,
      canceled: false,
    });
  });

  it('takes a time with no zone as written, and an address as the place, on one line', () => {
    const onsite = event(
      'DTSTART:20261021T090000',
      'DURATION:PT6H',
      'LOCATION:Northwind Labs\\, 500 Mar',
      ' ket St\\nSan Francisco\\, CA 94105',
    );
    expect(readInvite(onsite, CHICAGO)).toEqual({
      onDate: '2026-10-21',
      atTime: '09:00',
      minutes: 360,
      place: 'Northwind Labs, 500 Market St, San Francisco, CA 94105',
      online: false,
      people: [],
      zoneUnread: false,
      canceled: false,
    });
  });

  it('reads an all-day event as a day with no time, and a number to call as the place', () => {
    const allDay = event(
      'DTSTART;VALUE=DATE:20261023',
      'DTEND;VALUE=DATE:20261024',
      'LOCATION:tel:+1-555-010-0199',
    );
    expect(readInvite(allDay, CHICAGO)).toMatchObject({
      onDate: '2026-10-23',
      atTime: null,
      minutes: null,
      place: '+1-555-010-0199',
      online: false,
    });
  });

  it('reads a file with plain line ends, and a meeting’s link from its description', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261020T140000',
      'DESCRIPTION:Our careers page: https://northwind.example/careers\\nJoin: https://northw',
      ' ind.zoom.us/j/555?pwd=x.',
      'LOCATION:Zoom',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(readInvite(text)).toMatchObject({
      place: 'https://northwind.zoom.us/j/555?pwd=x',
      online: true,
    });
    // A description's other links aren't a meeting's.
    const careers = event('DTSTART:20261020T140000', 'DESCRIPTION:https://northwind.example/x');
    expect(readInvite(careers)).toMatchObject({ place: null, online: false });
  });

  it('says when its time zone can’t be read, and gives the time as written', () => {
    const mars = event('DTSTART;TZID=Mars/Olympus_Mons:20261020T140000', 'DURATION:PT30M');
    expect(readInvite(mars, CHICAGO)).toMatchObject({
      onDate: '2026-10-20',
      atTime: '14:00',
      minutes: 30,
      zoneUnread: true,
    });
  });

  it('says when it calls the meeting off', () => {
    const cancel = GOOGLE.replace('METHOD:REQUEST', 'METHOD:CANCEL');
    expect(readInvite(cancel, CHICAGO)?.canceled).toBe(true);
    const status = event('DTSTART:20261020T140000', 'STATUS:CANCELLED');
    expect(readInvite(status)?.canceled).toBe(true);
  });

  it('leaves out the user, by name or email, and anyone named only by an address', () => {
    const invite = event(
      'DTSTART:20261020T140000',
      'ORGANIZER;CN=Talent Team:mailto:jobs@northwind.example',
      'ATTENDEE;CN=Steve Hillyer;EMAIL=steve@example.com:mailto:steve@example.com',
      'ATTENDEE;CN=S. Hillyer:mailto:STEVE@example.com',
      'ATTENDEE;CN=dana@northwind.example:mailto:dana@northwind.example',
      'ATTENDEE:mailto:sam@northwind.example',
      'ATTENDEE;CN=talent team:mailto:other@northwind.example',
      'ATTENDEE;CUTYPE=ROOM;CN=Big Room:mailto:room@northwind.example',
      'ATTENDEE;CUTYPE=GROUP;CN=Interviewers:mailto:list@northwind.example',
    );
    expect(
      readInvite(invite, { me: { name: 'Steve Hillyer', email: 'steve@example.com' } })?.people,
    ).toEqual([{ name: 'Talent Team', role: null }]);
  });
});

describe('readInvite, with an invite meant to trick it', () => {
  it('keeps no link but an https one, and none with a name and password in it', () => {
    for (const link of [
      'javascript:alert(document.cookie)',
      'http://zoom.us/j/1',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      // Built in parts, so the repository's secret scan doesn't take it for a real one.
      ['https://user', 'secret@zoom.us/j/1'].join(':'),
    ]) {
      const invite = event('DTSTART:20261020T140000', `URL:${link}`, `LOCATION:${link}`);
      expect(readInvite(invite)).toMatchObject({ place: null, online: false });
    }
    const conference = event(
      'DTSTART:20261020T140000',
      'CONFERENCE;VALUE=URI;FEATURE=AUDIO:tel:+1-555-0100',
      'CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://meet.example.com/x',
    );
    expect(readInvite(conference)?.place).toBe('https://meet.example.com/x');
  });

  it('leaves out characters that hide or flip text, and cuts names and places to fit', () => {
    const invite = event(
      'DTSTART:20261020T140000',
      'ORGANIZER;CN="Dana\u202e Lee\u200b\u0007":mailto:dana@x.example',
      `ATTENDEE;CN="Sam^nOrtiz ^'Sammy^'":mailto:sam@x.example`,
      `ATTENDEE;CN=${'Ana '.repeat(100)}:mailto:ana@x.example`,
      `LOCATION:${'500 Market St '.repeat(100)}`,
    );
    const read = readInvite(invite, { limits: { place: 50, person: 20, people: 12 } });
    expect(read?.people).toEqual([
      { name: 'Dana Lee', role: null },
      { name: 'Sam Ortiz "Sammy"', role: null },
      { name: 'Ana Ana Ana Ana Ana', role: null },
    ]);
    expect(read?.place?.length).toBeLessThanOrEqual(50);
    // A character outside the basic plane isn't cut in half.
    const emoji = event('DTSTART:20261020T140000', `ATTENDEE;CN=${'😀'.repeat(30)}:mailto:a@x`);
    const name = readInvite(emoji, { limits: { place: 50, person: 9, people: 12 } })?.people[0];
    expect(name?.name).toBe('😀😀😀😀');
    expect(() => encodeURIComponent(name?.name ?? '')).not.toThrow();
  });

  it('takes at most the people the form holds, and passes over a meeting link too long for it', () => {
    const crowd = Array.from({ length: 40 }, (_, i) => `ATTENDEE;CN=Person ${i}:mailto:p${i}@x`);
    const long = `https://zoom.us/j/${'1'.repeat(600)}`;
    const read = readInvite(event('DTSTART:20261020T140000', ...crowd, `URL:${long}`));
    expect(read?.people).toHaveLength(12);
    expect(read?.place).toBeNull();
  });

  it('reads nothing from text that isn’t an invite, or one with no day that reads', () => {
    for (const text of [
      '',
      'hello',
      '<html><body>BEGIN:VEVENT</body></html>',
      ics('BEGIN:VCALENDAR', 'END:VCALENDAR'),
      event('SUMMARY:No day'),
      event('DTSTART:20261340T250000'),
      event('DTSTART:2026-10-20T14:00:00'),
      event('DTSTART:18991231T120000'),
      event('DTSTART:20261020T246000'),
    ]) {
      expect(readInvite(text)).toBeNull();
    }
    expect(readInvite(`${event('DTSTART:20261020T140000')}${' '.repeat(MAX_INVITE_LENGTH)}`)).toBe(
      null,
    );
    expect(readInvite(42 as unknown as string)).toBeNull();
  });

  it('gives no length for an end before its start, or longer than a day', () => {
    for (const end of [
      'DTEND:20261020T130000',
      'DTEND:20261023T140000',
      'DURATION:P30D',
      'DURATION:-PT1H',
      'DURATION:PT0M',
      'DURATION:soon',
    ]) {
      expect(readInvite(event('DTSTART:20261020T140000', end))?.minutes).toBeNull();
    }
  });

  it('passes over lines that don’t read, such as an open quote, and pollutes nothing', () => {
    const invite = event(
      'DTSTART:20261020T140000',
      'ATTENDEE;CN="Unclosed:mailto:a@x',
      'ATTENDEE;CN=Dana Lee;ROLE=x"y:mailto:b@x',
      '__proto__:polluted',
      'ATTENDEE;__proto__=yes;CN=Ana:mailto:c@x',
      'ATTENDEE;CN=Sam Ortiz:mailto:d@x',
      'END:VALARM',
      'END:VCALENDAR',
    );
    expect(readInvite(invite)?.people).toEqual([{ name: 'Sam Ortiz', role: null }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps to the first event, and to its first start', () => {
    const two = ics(
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261020T140000',
      'DTSTART:20261021T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261101T100000',
      'LOCATION:https://zoom.us/j/2',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    expect(readInvite(two)).toMatchObject({ onDate: '2026-10-20', atTime: '14:00', place: null });
  });

  it('reads a huge or tangled invite quickly', () => {
    const started = Date.now();
    const crowd = 'ATTENDEE;CN=a:mailto:a@x\r\n'.repeat(150_000);
    expect(readInvite(`${event('DTSTART:20261020T140000')}${crowd}`)).not.toBeNull();
    const oneLine = `BEGIN:VEVENT\r\nDTSTART:20261020T140000\r\nDESCRIPTION:${'https://'.repeat(400_000)}`;
    expect(readInvite(oneLine)?.place).toBeNull();
    const quotes = `BEGIN:VEVENT\r\nDTSTART:20261020T140000\r\nX${';a="'.repeat(500_000)}`;
    expect(readInvite(quotes)).not.toBeNull();
    const folds = `BEGIN:VEVENT\r\nDTSTART:20261020T140000\r\nDESCRIPTION:x${'\r\n y'.repeat(1_000_000)}`;
    expect(readInvite(folds)).not.toBeNull();
    const nested = `${'BEGIN:VEVENT\r\n'.repeat(50_000)}DTSTART:20261020T140000\r\n`;
    expect(readInvite(nested)).toMatchObject({ onDate: '2026-10-20' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
