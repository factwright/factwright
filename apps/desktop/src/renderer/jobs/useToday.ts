import { localDate } from '@factwright/core';
import { useEffect, useState } from 'react';

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
