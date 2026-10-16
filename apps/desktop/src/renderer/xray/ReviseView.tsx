import { localDate, shortDate } from '@factwright/core';
import { Button } from '@factwright/ui';
import type { Finding, FindingKind, Outcome } from '@factwright/xray';
import { CircleCheck, Minus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { MAX_FINDINGS, type Revision, type TemplateChoice } from '../../shared/revision.ts';
import styles from './XRay.module.css';

/** The three kinds of finding, as the user picks them, with how each gets fixed. */
const KINDS: readonly { kind: FindingKind; title: string; about?: string }[] = [
  { kind: 'content', title: 'Fix in the resume' },
  {
    kind: 'question',
    title: 'Ask you first',
    about:
      'Your Claude asks you about each before adding it. A yes goes in your fact bank, to verify, so your resume only says what’s true.',
  },
  {
    kind: 'template',
    title: 'From the template',
    about: 'These come from the template’s design, not your words.',
  },
];

/** The two ways to fix what comes from the template. */
const TEMPLATE_OPTIONS: readonly { value: TemplateChoice; label: string; about: string }[] = [
  {
    value: 'fix',
    label: 'Fix my template',
    about: 'It changes for every resume that uses it. Your Claude asks before saving it.',
  },
  {
    value: 'switch',
    label: 'Use a template that reads cleanly',
    about: 'For this job’s resume only. Your template stays as it is.',
  },
];

const OUTCOMES: Readonly<Record<Outcome, { icon: ReactNode; words: string; tone: string }>> = {
  fixed: { icon: <CircleCheck size={15} />, words: 'Fixed', tone: styles.pass ?? '' },
  'said-no': {
    icon: <Minus size={15} />,
    words: 'You said you don’t have it',
    tone: styles.settled ?? '',
  },
  open: { icon: <TriangleAlert size={15} />, words: 'Still there', tone: styles.fix ?? '' },
  unknown: {
    icon: <Minus size={15} />,
    words: 'Not checked this time',
    tone: styles.settled ?? '',
  },
};

/** When a revision was sent, as a day: "Oct 15". Nothing for a time that doesn't read. */
export function dayOf(revision: Revision): string {
  return Number.isNaN(Date.parse(revision.at)) ? '' : shortDate(revision.at, localDate());
}

/** When a revision was sent: "Oct 15 at 3:12 PM". */
export function sentAt(revision: Revision): string {
  const at = new Date(revision.at);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dayOf(revision)} at ${time}`;
}

/**
 * How much of what was picked a revision fixed: "2 of 3 fixed · 1 you don’t have", with the ones
 * this X-ray couldn't check apart.
 */
export function fixedText(outcomes: ReadonlyMap<string, Outcome>): string {
  const all = [...outcomes.values()];
  const count = (outcome: Outcome) => all.filter((each) => each === outcome).length;
  const [fixed, saidNo, unknown] = [count('fixed'), count('said-no'), count('unknown')];
  const checked = all.length - saidNo - unknown;
  return [
    checked > 0 && `${fixed} of ${checked} fixed`,
    saidNo > 0 && `${saidNo} you don’t have`,
    unknown > 0 && `${unknown} not checked`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The last revision of a resume, as its X-ray shows it. */
export interface LastRevisionState {
  revision: Revision;
  /** Whether the resume's been rebuilt since it was sent. */
  rebuilt: boolean;
  /** What became of each picked finding, when the X-ray shown is of the file that was revised. */
  outcomes: ReadonlyMap<string, Outcome> | null;
  /** What to say under it: what the X-ray said before, or why there's nothing to compare yet. */
  note: string;
}

/** The last revision of this file: what was picked, what the X-ray said before, and what's fixed. */
function LastRevision({
  last,
  onOpenPrevious,
}: {
  last: LastRevisionState;
  /** Opens the version from before the revision, and says why not when it can't. */
  onOpenPrevious: (() => Promise<string | null>) | null;
}) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const { revision, rebuilt, outcomes, note } = last;
  return (
    <section className={styles.lastRevision} aria-labelledby={id}>
      <h4 id={id} className={styles.lastTitle}>
        {rebuilt ? 'Revised' : 'Sent for revision'} {sentAt(revision)}
      </h4>
      <p className={styles.lastBefore}>
        {outcomes &&
          fixedText(outcomes)
            .split(' · ')
            .map((part) => (
              <span key={part}>
                {/* What got fixed stands out; what's settled or wasn't checked doesn't. */}
                {part.endsWith(' fixed') ? <span className={styles.lastFixed}>{part}</span> : part}
                {' · '}
              </span>
            ))}
        {note}
      </p>
      <ul className={styles.outcomes}>
        {revision.findings.map((finding) => {
          const outcome = outcomes?.get(finding.id);
          const shown = outcome ? OUTCOMES[outcome] : null;
          return (
            <li key={finding.id} className={styles.outcome}>
              <span className={shown?.tone ?? styles.waiting} aria-hidden="true">
                {shown?.icon ?? <Minus size={15} />}
              </span>
              <span className={styles.outcomeTitle}>{finding.title}</span>
              {shown && <span className={styles.outcomeWords}>{shown.words}</span>}
            </li>
          );
        })}
      </ul>
      {onOpenPrevious && (
        <Button
          size="sm"
          variant="quiet"
          className={styles.openPrevious}
          onClick={async () => setProblem(await onOpenPrevious())}
        >
          Open the previous version
        </Button>
      )}
      {problem && (
        <p className={styles.sendProblem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** One kind's findings, each with its checkbox. */
function KindGroup({
  title,
  about,
  findings,
  picked,
  onPick,
  children,
}: {
  title: string;
  about: string | undefined;
  findings: readonly Finding[];
  picked: (finding: Finding) => boolean;
  onPick: (finding: Finding, on: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const count = findings.filter(picked).length;
  return (
    <section aria-labelledby={id}>
      <h4 className={styles.groupTitle}>
        <span id={id}>{title}</span> <span className={styles.groupCount}>{count} picked</span>
      </h4>
      {about && <p className={styles.kindAbout}>{about}</p>}
      <ul className={styles.picks}>
        {findings.map((finding) => (
          <li key={finding.id}>
            <label className={styles.pickRow}>
              <input
                type="checkbox"
                checked={picked(finding)}
                onChange={(event) => onPick(finding, event.target.checked)}
              />
              <span>{finding.title}</span>
            </label>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

/**
 * Send for revision: what the X-ray found that a run can fix, each with a checkbox, the fixable
 * ones ticked to start. Above it, the last revision of this file and what it fixed.
 */
export function ReviseView({
  findings,
  readable,
  picked,
  onPick,
  template,
  onTemplate,
  last,
  onOpenPrevious,
  locked,
  known,
  ready,
  busy,
  sending,
  problem,
  onSend,
}: {
  findings: readonly Finding[];
  /** Whether the file has text to read, without which there's nothing to revise. */
  readable: boolean;
  picked: (finding: Finding) => boolean;
  onPick: (finding: Finding, on: boolean) => void;
  template: TemplateChoice | null;
  onTemplate: (choice: TemplateChoice) => void;
  /** The last revision of this resume, if there's been one. */
  last: LastRevisionState | null;
  onOpenPrevious: (() => Promise<string | null>) | null;
  /** Why this resume can't be revised, such as that it went out with the application. */
  locked: string | null;
  /** Whether the app has said yet where the resume stands. Until it has, nothing's sent. */
  known: boolean;
  /** Whether Claude Code is ready to run. */
  ready: boolean;
  /** Whether Claude is busy with another run, which a revision waits for. */
  busy: boolean;
  sending: boolean;
  problem: string | null;
  onSend: () => void;
}) {
  const choiceName = useId();
  const count = findings.filter(picked).length;
  const templated = findings.some((finding) => finding.kind === 'template' && picked(finding));
  const waiting =
    count === 0
      ? 'Pick at least one.'
      : count > MAX_FINDINGS
        ? `Pick ${MAX_FINDINGS} at most.`
        : templated && !template
          ? 'Pick how to fix the template.'
          : !ready
            ? 'Your Claude isn’t ready yet. The card in the sidebar says what to do.'
            : busy
              ? 'Your Claude is busy with another run. Send this once it’s done.'
              : !known
                ? ''
                : null;
  return (
    <div className={styles.groups}>
      {last && <LastRevision last={last} onOpenPrevious={onOpenPrevious} />}
      {locked ? (
        <p className={styles.honest}>{locked}</p>
      ) : !readable ? (
        <p className={styles.empty}>There’s no text in this file to revise.</p>
      ) : findings.length === 0 ? (
        <p className={styles.empty}>
          {last
            ? 'Nothing else to revise: the X-ray found nothing more to fix.'
            : 'Nothing to revise: the X-ray found nothing to fix.'}
        </p>
      ) : (
        <>
          <p className={styles.honest}>
            Pick what to fix. Factwright keeps this version, then your Claude makes the changes in a
            run you can follow, and rebuilds the resume. Open the X-ray again after to see what got
            fixed.
          </p>
          {KINDS.map(({ kind, title, about }) => {
            const ofKind = findings.filter((finding) => finding.kind === kind);
            if (ofKind.length === 0) return null;
            return (
              <KindGroup
                key={kind}
                title={title}
                about={about}
                findings={ofKind}
                picked={picked}
                onPick={onPick}
              >
                {kind === 'template' && templated && (
                  <fieldset className={styles.choices}>
                    <legend className={styles.choicesLegend}>How to fix it</legend>
                    {TEMPLATE_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`${styles.choice} ${template === option.value ? styles.chosen : ''}`}
                      >
                        <input
                          type="radio"
                          name={choiceName}
                          value={option.value}
                          checked={template === option.value}
                          onChange={() => onTemplate(option.value)}
                        />
                        <span className={styles.choiceText}>
                          <span className={styles.choiceLabel}>{option.label}</span>
                          <span className={styles.choiceAbout}>{option.about}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </KindGroup>
            );
          })}
        </>
      )}
      {!locked && readable && findings.length > 0 && (
        <div className={styles.send}>
          {problem && (
            <p className={styles.sendProblem} role="alert">
              {problem}
            </p>
          )}
          {waiting && !problem && <p className={styles.sendWhy}>{waiting}</p>}
          <Button
            variant="primary"
            disabled={waiting !== null || sending}
            onClick={onSend}
            className={styles.sendButton}
          >
            {sending ? 'Sending…' : `Send ${count} for revision`}
          </Button>
        </div>
      )}
    </div>
  );
}
