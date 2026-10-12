import { Button, Steps } from '@factwright/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { wordCount } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ClaudeStatusView } from '../useClaudeStatus.ts';
import { ClaudeReady } from './ClaudeReady.tsx';
import styles from './GetStarted.module.css';
import { AboutYouStep } from './steps/AboutYouStep.tsx';
import { FilesStep } from './steps/FilesStep.tsx';
import { ReadyStep } from './steps/ReadyStep.tsx';
import { TemplatesStep } from './steps/TemplatesStep.tsx';
import { WantsStep } from './steps/WantsStep.tsx';
import { WelcomeStep } from './steps/WelcomeStep.tsx';
import { WordsStep } from './steps/WordsStep.tsx';
import type { ProfileState } from './useProfile.ts';

export const STEPS = [
  'Welcome',
  'About you',
  'Your files',
  'In your words',
  'What you want',
  'Templates',
  'Ready',
] as const;

/** The fewest words about themselves that, without a file, give Claude something to start from. */
const ENOUGH_WORDS = 20;

/**
 * Getting started: everything Factwright asks a new user, a step at a time, saved as they go so
 * they can stop and come back. The last step hands it all to their Claude, which drafts their
 * fact bank, interviews them to confirm it, and builds their starting resumes.
 */
export function GetStarted({
  state,
  api,
  claude,
  onRecheckClaude,
  canStartClaude,
  onStart,
  onSkip,
  onOpenSync,
}: {
  state: ProfileState & { profile: NonNullable<ProfileState['profile']> };
  api: FactwrightApi;
  claude: ClaudeStatusView;
  onRecheckClaude: () => void;
  /** Whether Claude is ready and free to take this on. */
  canStartClaude: boolean;
  /** Starts Claude on getting to know the user, once the workspace is ready for it. */
  onStart: () => void;
  onSkip: () => void;
  /** Opens sync, for someone who already has a job hunt on another computer. */
  onOpenSync: () => void;
}) {
  const { profile, update } = state;
  const { answers, notes } = profile;
  const step = Math.min(answers.step, STEPS.length - 1);
  const page = useRef<HTMLElement>(null);

  const go = (next: number) => {
    void state.flush();
    update({ step: next, reached: Math.max(answers.reached, next) });
    page.current?.scrollTo({ top: 0 });
  };

  // Each new step's heading takes focus once it's on screen, so a screen reader starts there.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    page.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [step]);

  const claudeBox = <ClaudeReady status={claude} onRecheck={onRecheckClaude} api={api} />;
  const enough = answers.files.length > 0 || wordCount(notes) >= ENOUGH_WORDS;
  const ready = claude !== 'checking' && claude.state === 'ready';
  const why = !enough
    ? 'Add a resume, or tell us about yourself, first.'
    : !ready
      ? 'Your Claude needs to be ready first.'
      : !canStartClaude
        ? 'Claude is busy. Wait for it to finish, or stop it.'
        : null;

  const start = async () => {
    await state.flush();
    state.take(await api.startProfile());
    onStart();
  };

  return (
    <main ref={page} className={styles.page}>
      <div className={styles.bar}>
        <Steps
          label="Getting started"
          steps={STEPS}
          current={step}
          reached={Math.max(answers.reached, step)}
          onSelect={go}
        />
      </div>
      <div className={styles.body}>
        {step === 0 && <WelcomeStep claude={claudeBox} onOpenSync={onOpenSync} />}
        {step === 1 && <AboutYouStep you={answers.you} update={update} />}
        {step === 2 && (
          <FilesStep
            answers={answers}
            api={api}
            onChanged={(latest) => (latest ? state.take(latest) : void state.refresh())}
          />
        )}
        {step === 3 && (
          <WordsStep
            notes={notes}
            saved={state.saved}
            onNotes={state.setNotes}
            confidential={profile.confidential}
            onConfidential={(names) => void state.saveConfidential(names)}
          />
        )}
        {step === 4 && <WantsStep answers={answers} update={update} />}
        {step === 5 && <TemplatesStep answers={answers} update={update} api={api} />}
        {step === 6 && (
          <ReadyStep
            answers={answers}
            notes={notes}
            canStart={why === null}
            why={why}
            onStart={() => void start()}
            onEdit={go}
            claude={ready ? null : claudeBox}
          />
        )}
        {state.problem && (
          <p className={styles.problem} role="alert">
            {state.problem}
          </p>
        )}
      </div>
      <div className={styles.nav}>
        {step > 0 ? (
          <Button
            variant="quiet"
            icon={<ArrowLeft size={16} aria-hidden="true" />}
            onClick={() => go(step - 1)}
          >
            Back
          </Button>
        ) : (
          <Button variant="quiet" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {step < STEPS.length - 1 && (
          <Button variant="primary" onClick={() => go(step + 1)}>
            {step === 0 ? 'Get started' : 'Continue'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </div>
    </main>
  );
}
