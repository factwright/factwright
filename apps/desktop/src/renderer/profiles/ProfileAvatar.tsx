import styles from './Profiles.module.css';

/** The tints a profile's initial can take. Each profile keeps one, picked by its ID. */
const TINTS = ['blue', 'teal', 'violet', 'amber', 'green', 'purple', 'slate'] as const;

function tintOf(id: string): (typeof TINTS)[number] {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[sum % TINTS.length] ?? 'blue';
}

/** A profile's initial in its own color, so profiles tell apart at a glance. Screen readers skip it. */
export function ProfileAvatar({ id, name }: { id: string; name: string }) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?';
  return (
    <span className={`${styles.avatar} ${styles[tintOf(id)]}`} aria-hidden="true">
      {initial}
    </span>
  );
}
