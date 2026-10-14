import { PRIVACY_URL, TERMS_URL } from '@factwright/core';
import { Button, Logo } from '@factwright/ui';
import { CircleCheck, Laptop, LockKeyhole } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import styles from './steps.module.css';
import welcome from './WelcomeStep.module.css';

interface Point {
  icon: ReactNode;
  title: string;
  text: string;
}

const POINTS: readonly Point[] = [
  {
    icon: <Laptop size={18} aria-hidden="true" />,
    title: 'Your own Claude does the work',
    text: 'Factwright runs Claude Code on this computer, signed in as you. It never sees your Claude login, and runs count toward your own Claude plan.',
  },
  {
    icon: <CircleCheck size={18} aria-hidden="true" />,
    title: 'Nothing goes on a resume until you confirm it',
    text: 'Claude drafts your facts from what you share, then asks you to check each one. Every resume is fact-checked against them.',
  },
];

/** Where the user's files stay, and whether sync can take them to their other devices. */
function filesPoint(canSync: boolean): Point {
  return {
    icon: <LockKeyhole size={18} aria-hidden="true" />,
    title: 'Your files stay on this computer',
    text: canSync
      ? 'Turn on sync later to see your job hunt on your phone and other computers, locked with a key only you hold.'
      : 'This copy of Factwright was built without sync, so your job hunt is kept here alone.',
  };
}

/**
 * The first step: what Factwright does, how it treats the user's data, and their Claude. Someone
 * who already uses Factwright on another computer turns on sync instead of starting over, unless
 * this copy was built without it, which `onOpenSync` is null for.
 */
export function WelcomeStep({
  claude,
  onOpenSync,
}: {
  claude: ReactNode;
  onOpenSync: (() => void) | null;
}) {
  const titleId = useId();
  const points = [...POINTS, filesPoint(onOpenSync !== null)];
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div className={welcome.hero}>
        <Logo size={36} />
        <h2 id={titleId} className={welcome.title} tabIndex={-1}>
          Let’s get you set up
        </h2>
        <p className={styles.lead}>
          Factwright learns your background, keeps it in a fact bank of what’s true about you, and
          turns it into resumes and job searches that fit. Setting up takes about 20 minutes, and
          you can stop any time and pick up where you left off.
        </p>
      </div>
      <ul className={welcome.points}>
        {points.map((point) => (
          <li key={point.title} className={welcome.point}>
            <span className={welcome.icon}>{point.icon}</span>
            <span>
              <strong className={welcome.pointTitle}>{point.title}</strong>
              <span className={welcome.pointText}>{point.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {claude}
      <p className={styles.note}>
        Using Factwright means you agree to its{' '}
        <a href={TERMS_URL} target="_blank" rel="noreferrer">
          terms of service
        </a>
        . Its{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
          privacy policy
        </a>{' '}
        says what it collects.
      </p>
      {onOpenSync && (
        <p className={styles.note}>
          Already use Factwright on another computer?{' '}
          <Button variant="quiet" size="sm" onClick={onOpenSync}>
            Turn on sync
          </Button>{' '}
          to bring your job hunt here instead.
        </p>
      )}
    </section>
  );
}
