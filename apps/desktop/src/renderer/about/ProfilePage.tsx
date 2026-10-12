import type { JobFile } from '@factwright/core';
import { TEMPLATES } from '@factwright/engine/templates';
import { Button, Dialog, DialogActions, VisuallyHidden } from '@factwright/ui';
import { Check, Circle, FileText, LoaderCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { labelOf, pagesFor, RESUME_FILES } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { StartingResume } from '../../shared/profile.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ResumePreview } from '../jobs/ResumePreview.tsx';
import { BUSY } from '../jobs/RunActions.tsx';
import type { RunPhase } from '../useClaudeRun.ts';
import styles from './ProfilePage.module.css';
import { AboutYouStep } from './steps/AboutYouStep.tsx';
import { FilesStep } from './steps/FilesStep.tsx';
import { looksSummary, sharedSummary, wantsSummary } from './steps/ReadyStep.tsx';
import { TemplatesStep } from './steps/TemplatesStep.tsx';
import { WantsStep } from './steps/WantsStep.tsx';
import { WordsStep } from './steps/WordsStep.tsx';
import type { ProfileState } from './useProfile.ts';

type Editing = 'about' | 'files' | 'words' | 'wants' | 'templates' | null;

/** A layout's template name, such as "Classic" for "classic". */
const templateName = (layout: string) =>
  TEMPLATES.find((template) => template.layout === layout)?.name ?? layout;

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/** One thing on the way to a finished profile, done or not yet. */
function Milestone({
  done,
  working,
  children,
}: {
  done: boolean;
  working: boolean;
  children: ReactNode;
}) {
  return (
    <li className={styles.milestone}>
      <span className={done ? styles.done : styles.todo} aria-hidden="true">
        {done ? (
          <Check size={12} strokeWidth={2.8} />
        ) : working ? (
          <LoaderCircle size={12} className={styles.spin} />
        ) : (
          <Circle size={8} />
        )}
      </span>
      <span>
        {children}
        {done && <VisuallyHidden> (done)</VisuallyHidden>}
      </span>
    </li>
  );
}

function Card({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <div className={styles.cardBody}>{children}</div>
      {actions && <div className={styles.cardActions}>{actions}</div>}
    </section>
  );
}

/** A starting resume's file, as a job's panel would show one, for its preview. */
const asJobFile = (path: string, format: 'pdf' | 'docx'): JobFile => ({
  path,
  name: path.split('/').at(-1) ?? path,
  format,
  size: 0,
  modified: '',
});

/**
 * Everything Factwright knows about the user, and how far it's come: their fact bank, their
 * starting resumes, what they want, their templates, and what they've shared. Each part can be
 * changed here, and Claude can be sent to carry on.
 */
export function ProfilePage({
  state,
  api,
  phase,
  ready,
  onRun,
}: {
  state: ProfileState & { profile: NonNullable<ProfileState['profile']> };
  api: FactwrightApi;
  /** Where Claude's run stands, so buttons wait while it's busy. */
  phase: RunPhase;
  /** Whether Claude Code is ready to run. */
  ready: boolean;
  onRun: (task: RunTask) => void;
}) {
  const { profile } = state;
  const { answers, status } = profile;
  const [editing, setEditing] = useState<Editing>(null);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const busy = BUSY.includes(phase);
  const canRun = ready && !busy;
  const { claims, unconfirmed, files } = status.facts;
  const started = answers.startedOn !== null;
  const building = status.starting.some((each) => each.pdf || each.docx);
  const working = busy;

  const run = (task: RunTask) => onRun(task);
  // Until Claude has finished getting to know the user, carrying on is the page's main action.
  const inProgress = started && (claims === 0 || unconfirmed > 0 || !building);
  const runButton = (label: string, task: RunTask, primary = false) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      disabled={!canRun}
      onClick={() => run(task)}
    >
      {label}
    </Button>
  );

  const fresh = status.unread.length + (status.notesChanged ? 1 : 0);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.subtitle}>
          {[answers.you.name, answers.roles[0]].filter(Boolean).join(' · ') ||
            'What Factwright knows about you'}
        </p>
      </header>

      {inProgress && (
        <section className={styles.progress} aria-label="Getting to know you">
          <h2 className={styles.cardTitle}>Getting to know you</h2>
          <ol className={styles.milestones}>
            <Milestone done={claims > 0} working={working && claims === 0}>
              {claims > 0
                ? `Read what you shared and drafted ${plural(claims, 'fact')}`
                : 'Reading what you shared and drafting your fact bank'}
            </Milestone>
            <Milestone
              done={claims > 0 && unconfirmed === 0}
              working={working && claims > 0 && unconfirmed > 0}
            >
              {claims === 0
                ? 'Confirming each fact with you'
                : unconfirmed > 0
                  ? `Confirming with you: ${plural(unconfirmed, 'fact')} still to check`
                  : 'Confirmed every fact with you'}
            </Milestone>
            <Milestone
              done={building}
              working={working && claims > 0 && unconfirmed === 0 && !building}
            >
              {building ? 'Built your starting resumes' : 'Building your starting resumes'}
            </Milestone>
          </ol>
          <div className={styles.cardActions}>
            {busy ? (
              <p className={styles.quiet}>Your Claude is working on it in the panel below.</p>
            ) : (
              runButton('Carry on with your Claude', { skill: 'get-started' }, true)
            )}
          </div>
        </section>
      )}

      <div className={styles.grid}>
        <Card
          title="Your fact bank"
          actions={
            <>
              {runButton(
                unconfirmed > 0 ? 'Confirm your facts' : 'Interview me for more',
                { skill: 'add-facts', mode: 'interview' },
                unconfirmed > 0 && !inProgress,
              )}
              {fresh > 0 && runButton('Add what’s new', { skill: 'add-facts', mode: 'new' })}
            </>
          }
        >
          {claims > 0 ? (
            <>
              <p className={styles.big}>{plural(claims, 'fact')}</p>
              <p className={styles.quiet}>
                In {plural(files, 'file')}.{' '}
                {unconfirmed > 0
                  ? `${plural(unconfirmed, 'fact')} still to confirm with you.`
                  : 'All confirmed with you.'}
              </p>
              {fresh > 0 && (
                <p className={styles.need}>
                  {status.unread.length > 0 &&
                    `${plural(status.unread.length, 'file')} not read yet. `}
                  {status.notesChanged && 'Your notes changed since Claude last read them.'}
                </p>
              )}
            </>
          ) : (
            <p className={styles.quiet}>
              Every claim on your resumes comes from here. Your Claude builds it from what you
              share.
            </p>
          )}
        </Card>

        <Card
          title="Starting resumes"
          actions={
            claims > 0
              ? runButton(status.starting.length > 0 ? 'Build them again' : 'Build them', {
                  skill: 'get-started',
                  mode: 'resumes',
                })
              : undefined
          }
        >
          {status.starting.length > 0 ? (
            <ul className={styles.resumes}>
              {status.starting.map((resume: StartingResume) => (
                <li key={resume.path} className={styles.resume}>
                  <FileText size={16} aria-hidden="true" />
                  <span className={styles.resumeName}>
                    {resume.title}
                    <span className={styles.resumeLook}>{templateName(resume.layout)}</span>
                  </span>
                  {resume.pdf && (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => setPreview(asJobFile(resume.pdf as string, 'pdf'))}
                    >
                      Preview
                    </Button>
                  )}
                  {(resume.pdf || resume.docx) && (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => void api.openFile((resume.pdf ?? resume.docx) as string)}
                    >
                      Open
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.quiet}>
              One resume for each template you picked, ready to send or tailor. Your Claude builds
              them once your facts are confirmed.
            </p>
          )}
        </Card>

        <Card
          title="What you want"
          actions={
            <Button size="sm" onClick={() => setEditing('wants')}>
              Change
            </Button>
          }
        >
          <p>{wantsSummary(answers) ?? 'Nothing yet.'}</p>
          {status.criteria === 'own' && (
            <div className={styles.own}>
              <p className={styles.quiet}>
                Your search criteria file was changed by hand, so it’s kept as it is, and these
                answers don’t change it.
              </p>
              <Button size="sm" variant="quiet" onClick={() => void api.useAnswersForCriteria()}>
                Use these answers instead
              </Button>
            </div>
          )}
        </Card>

        <Card
          title="Resume templates"
          actions={
            <Button size="sm" onClick={() => setEditing('templates')}>
              Change
            </Button>
          }
        >
          <p>{looksSummary(answers) ?? 'None picked yet.'}</p>
          <p className={styles.quiet}>
            {pagesFor(answers) === 1 ? 'One page' : 'Up to two pages'} ·{' '}
            {labelOf(RESUME_FILES, answers.format)}
          </p>
        </Card>

        <Card
          title="What you’ve shared"
          actions={
            <>
              <Button size="sm" onClick={() => setEditing('files')}>
                Add files
              </Button>
              <Button size="sm" onClick={() => setEditing('words')}>
                Your words
              </Button>
            </>
          }
        >
          <p>{sharedSummary(answers) ?? 'No files yet.'}</p>
          {status.connections && (
            <p className={styles.quiet}>
              {plural(status.connections.count, 'LinkedIn connection')}
              {status.connections.added && `, from ${status.connections.added}`}. Who to message
              uses them.
            </p>
          )}
        </Card>

        <Card
          title="About you"
          actions={
            <Button size="sm" onClick={() => setEditing('about')}>
              Change
            </Button>
          }
        >
          <p>{answers.you.name || 'No name yet.'}</p>
          <p className={styles.quiet}>
            {[answers.you.email, answers.you.phone, answers.you.location]
              .filter(Boolean)
              .join(' · ') || 'No contact details yet.'}
          </p>
        </Card>
      </div>

      {editing && (
        <Dialog
          title={
            {
              about: 'About you',
              files: 'What you’ve shared',
              words: 'In your words',
              wants: 'What you want',
              templates: 'Resume templates',
            }[editing]
          }
          size="lg"
          onClose={() => {
            void state.flush();
            setEditing(null);
          }}
        >
          {(close) => (
            <div className={styles.editor}>
              {editing === 'about' && <AboutYouStep you={answers.you} update={state.update} />}
              {editing === 'files' && (
                <FilesStep
                  answers={answers}
                  api={api}
                  onChanged={(latest) => (latest ? state.take(latest) : void state.refresh())}
                />
              )}
              {editing === 'words' && (
                <WordsStep
                  notes={profile.notes}
                  saved={state.saved}
                  onNotes={state.setNotes}
                  confidential={profile.confidential}
                  onConfidential={(names) => void state.saveConfidential(names)}
                />
              )}
              {editing === 'wants' && <WantsStep answers={answers} update={state.update} />}
              {editing === 'templates' && (
                <TemplatesStep answers={answers} update={state.update} api={api} />
              )}
              <DialogActions>
                <Button variant="primary" onClick={close}>
                  Done
                </Button>
              </DialogActions>
            </div>
          )}
        </Dialog>
      )}
      {preview && <ResumePreview file={preview} api={api} onClose={() => setPreview(null)} />}
    </main>
  );
}
