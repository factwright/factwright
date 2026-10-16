import { type Job, localDate, nextCallMoment } from '@factwright/core';
import { useEffect, useMemo, useState } from 'react';

/** The user's date, which moves on at midnight so "Due today" stays true. */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(
      () => setToday(localDate()),
      midnight.getTime() - now.getTime() + 1000,
    );
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

/** The time of day, as "HH:MM". */
export function timeOfDay(at = new Date()): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/**
 * The time of day, as "HH:MM", moving on only when one of today's calls starts or ends, so a job's
 * next call and what it asks of the user change then, without redrawing the list every minute.
 */
export function useCallClock(jobs: readonly Job[], today: string): string {
  const [clock, setClock] = useState(timeOfDay);
  const calls = useMemo(() => jobs.flatMap((job) => job.calls), [jobs]);
  useEffect(() => {
    // Catch up after the computer slept, or once the list changes.
    const now = timeOfDay();
    if (now !== clock) {
      setClock(now);
      return;
    }
    const next = nextCallMoment(calls, today, clock);
    if (!next) return;
    const at = new Date();
    at.setHours(Number(next.slice(0, 2)), Number(next.slice(3, 5)), 0, 0);
    const timer = setTimeout(() => setClock(timeOfDay()), at.getTime() - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [calls, today, clock]);
  return clock;
}
