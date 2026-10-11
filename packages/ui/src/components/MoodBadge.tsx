import type { Mood } from '@factwright/core';
import type { Tone } from '../tokens.ts';
import { Pill } from './Pill.tsx';

/** How each mood reads on screen, and its tint. */
export const MOOD_DISPLAY: Readonly<Record<Mood, { label: string; tone: Tone }>> = {
  loved: { label: 'People love it', tone: 'green' },
  liked: { label: 'People like it', tone: 'green' },
  mixed: { label: 'Mixed', tone: 'amber' },
  disliked: { label: 'People dislike it', tone: 'red' },
  hated: { label: 'People hate it', tone: 'red' },
  thin: { label: 'Little to go on', tone: 'gray' },
  skipped: { label: 'Not looked up', tone: 'gray' },
};

/** What people say about working at a company, in a word or two. */
export function MoodBadge({ mood }: { mood: Mood }) {
  const { label, tone } = MOOD_DISPLAY[mood];
  return <Pill tone={tone}>{label}</Pill>;
}
