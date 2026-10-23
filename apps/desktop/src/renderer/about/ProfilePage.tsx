import type { ForApplications, JobFile } from '@factwright/core';
import { Button, Dialog, DialogActions, VisuallyHidden } from '@factwright/ui';
import { Check, Circle, FileText, LoaderCircle, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { labelOf, OVER_18, pagesFor, RESUME_FILES, SPONSORSHIP } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import { labelIn, PAGE_SHAPE_CHOICES } from '../../shared/beyond.ts';
import { hasKinds, kindsOf } from '../../shared/kinds.ts';
import { templateName } from '../../shared/looks.ts';
import type { StartingResume, TemplateInfo } from '../../shared/profile.ts';
import type { ProfileEntry } from '../../shared/profiles.ts';
import { type RunTask, TEMPLATE_SKILL } from '../../shared/runs.ts';
import { ResumePreview } from '../jobs/ResumePreview.tsx';
import { BUSY } from '../jobs/RunActions.tsx';
import { ProfilesLine } from '../profiles/ProfilesLine.tsx';
import type { RunPhase } from '../useClaudeRun.ts';
import { OpenXRay } from '../xray/OpenXRay.tsx';
import type { XRayFile } from '../xray/useXRay.ts';
import styles from './ProfilePage.module.css';
import { AboutYouStep } from './steps/AboutYouStep.tsx';
import { ApplicationsStep } from './steps/ApplicationsStep.tsx';
import {
  BeyondWorkStep,
  outsideLines,
  placementSummary,
  projectLine,
  ShowingPill,
} from './steps/BeyondWorkStep.tsx';
import { FilesStep } from './steps/FilesStep.tsx';
import {
  looksSummary,
  placesSummary,
  sharedSummary,
  wantsSummary,
  workSummary,
} from './steps/ReadyStep.tsx';
import { TemplatesStep } from './steps/TemplatesStep.tsx';
import { WantsStep } from './steps/WantsStep.tsx';
import { WordsStep } from './steps/WordsStep.tsx';
import type { ProfileState } from './useProfile.ts';

type Editing =
  | 'about'
  | 'applications'
  | 'files'
  | 'words'
  | 'wants'
  | 'templates'
  | 'beyond'
  | null;

/** How the projects are ordered on the card: featured first, then as the user added them. */
const SHOWN_FIRST = { feature: 0, fit: 1, private: 2 } as const;

/** "In a section" as it reads after a colon: "in a section". */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What Profile keeps for applications, in a line: where you can work, and sponsorship. */
function applicationsSummary(applications: ForApplications): string {
  const where =
    applications.countries.length > 0 ? `Works in ${applications.countries.join(', ')}` : '';
  const sponsorship = applications.sponsorship
    ? `Sponsorship: ${labelOf(SPONSORSHIP, applications.sponsorship).toLowerCase()}`
    : '';
  const adult = applications.over18
    ? `18 or older: ${labelOf(OVER_18, applications.over18).toLowerCase()}`
    : '';
  return [where, sponsorship, adult].filter(Boolean).join(' · ') || 'Nothing yet.';
}

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
  wide = false,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Whether it takes the grid's whole width. */
  wide?: boolean;
}) {
  return (
    <section
      className={wide ? `${styles.card} ${styles.wideCard}` : styles.card}
      aria-label={title}
    >
      <h2 className={styles.cardTitle}>{title}</h2>
      <div className={styles.cardBody}>{children}</div>
      {actions && <div className={styles.cardActions}>{actions}</div>}
    </section>
  );
}

/** A starting resume, with buttons to preview it, X-ray it and open it. */
function ResumeRow({
  resume,
  templates,
  onPreview,
  onXRay,
  onOpen,
}: {
  resume: StartingResume;
  templates: readonly TemplateInfo[];
  onPreview: (path: string) => void;
  onXRay: () => void;
  onOpen: (path: string) => void;
}) {
  return (
    <li className={styles.resume}>
      <FileText size={16} aria-hidden="true" />
      <span className={styles.resumeName}>
        {resume.title}
        <span className={styles.resumeLook}>{templateName(resume.layout, templates)}</span>
      </span>
      <span className={styles.resumeActions}>
        {resume.pdf && (
          <Button size="sm" variant="quiet" onClick={() => onPreview(resume.pdf as string)}>
            Preview
          </Button>
        )}
        {(resume.pdf || resume.docx) && (
          <Button
            size="sm"
            variant="quiet"
            aria-label={`ATS X-ray of ${resume.title}`}
            onClick={onXRay}
          >
            ATS X-ray
          </Button>
        )}
        {(resume.pdf || resume.docx) && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => onOpen((resume.pdf ?? resume.docx) as string)}
          >
            Open
          </Button>
        )}
      </span>
    </li>
  );
}

/** A starting resume's files, its PDF first, for its X-ray. */
const filesOf = (resume: StartingResume): XRayFile[] =>
  (['pdf', 'docx'] as const).flatMap((format) => {
    const path = resume[format];
    return path ? [{ path, name: path.split('/').at(-1) ?? path, format }] : [];
  });

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
  onOpenFacts,
  profiles,
}: {
  state: ProfileState & { profile: NonNullable<ProfileState['profile']> };
  api: FactwrightApi;
  /** Where Claude's run stands, so buttons wait while it's busy. */
  phase: RunPhase;
  /** Whether Claude Code is ready to run. */
  ready: boolean;
  onRun: (task: RunTask) => void;
  /** Opens the fact bank, to read and change each fact. */
  onOpenFacts: () => void;
  /** The profiles on this computer, to add one for someone else or manage them. */
  profiles?: { list: ProfileEntry[]; onAdd: () => void; onManage: () => void };
}) {
  const { profile } = state;
  const { answers, status } = profile;
  const [editing, setEditing] = useState<Editing>(null);
  // The Beyond work dialog opened to add a project, which starts with a new one open.
  const [addingProject, setAddingProject] = useState(false);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [xray, setXray] = useState<StartingResume | null>(null);
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

  const fresh =
    status.unread.length + (status.notesChanged ? 1 : 0) + (status.beyondChanged ? 1 : 0);
  const projects = [...answers.projects].sort(
    (a, b) => SHOWN_FIRST[a.showing] - SHOWN_FIRST[b.showing],
  );
  const outside = outsideLines(answers);
  // With more than one kind of job, each has its own work and starting resumes.
  const kinds = hasKinds(answers) ? kindsOf(answers) : null;
  const firstKind = kinds?.[0]?.id ?? '';
  const resumesOf = (kind: string) =>
    status.starting.filter((resume) => (resume.kind ?? firstKind) === kind);
  const missing = kinds?.some((kind) => resumesOf(kind.id).length === 0) ?? false;
  const resumeRow = (resume: StartingResume) => (
    <ResumeRow
      key={resume.path}
      resume={resume}
      templates={profile.templates}
      onPreview={(path) => setPreview(asJobFile(path, 'pdf'))}
      onXRay={() => setXray(resume)}
      onOpen={(path) => void api.openFile(path)}
    />
  );

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.subtitle}>
          {[answers.you.name, ...(kinds ? kinds.map((kind) => kind.name) : [answers.roles[0]])]
            .filter(Boolean)
            .join(' · ') || 'What Factwright knows about you'}
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
                ? 'Checking each fact with you'
                : unconfirmed > 0
                  ? `Checking with you: ${plural(unconfirmed, 'fact')} to verify`
                  : 'Verified every fact with you'}
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
                unconfirmed > 0 ? 'Verify your facts' : 'Interview me for more',
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
                {unconfirmed > 0 ? `${plural(unconfirmed, 'fact')} to verify.` : 'All verified.'}
              </p>
              {fresh > 0 && (
                <p className={styles.need}>
                  {status.unread.length > 0 &&
                    `${plural(status.unread.length, 'file')} not read yet. `}
                  {status.notesChanged && 'Your notes changed since Claude last read them. '}
                  {status.beyondChanged && 'Your projects changed since Claude last read them.'}
                </p>
              )}
              <div>
                <Button size="sm" variant="quiet" onClick={onOpenFacts}>
                  See and change them
                </Button>
              </div>
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
              ? runButton(
                  status.starting.length > 0 && !missing ? 'Build them again' : 'Build them',
                  { skill: 'get-started', mode: 'resumes' },
                )
              : undefined
          }
        >
          {status.starting.length === 0 ? (
            <p className={styles.quiet}>
              One resume for each template you picked
              {kinds ? ', for each kind of job' : ''}, ready to send or tailor. Your Claude builds
              them once your facts are verified.
            </p>
          ) : kinds ? (
            kinds.map((kind) => (
              <div key={kind.id} className={styles.kindResumes}>
                <h3 className={styles.kindName}>{kind.name}</h3>
                {resumesOf(kind.id).length > 0 ? (
                  <ul className={styles.resumes}>{resumesOf(kind.id).map(resumeRow)}</ul>
                ) : (
                  <p className={styles.quiet}>None yet. Build them to make a set for it.</p>
                )}
              </div>
            ))
          ) : (
            <ul className={styles.resumes}>{status.starting.map(resumeRow)}</ul>
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
          {kinds ? (
            <>
              <ul className={styles.kinds}>
                {kinds.map((kind) => (
                  <li key={kind.id}>
                    <span className={styles.kindName}>{kind.name}</span>
                    <span className={styles.quiet}>{workSummary(kind) || 'Nothing yet'}</span>
                  </li>
                ))}
              </ul>
              {placesSummary(answers) && <p>{placesSummary(answers)}</p>}
            </>
          ) : (
            <p>{wantsSummary(answers) ?? 'Nothing yet.'}</p>
          )}
          {status.criteria === 'own' && (
            <div className={styles.own}>
              <p className={styles.quiet}>
                Your search criteria file was changed by hand, so it’s kept as it is, and these
                answers don’t change it.
                {kinds &&
                  ' For a kind of job it has no section for, searches use that kind’s titles, levels and pay from here.'}
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
          <p>{looksSummary(answers, profile.templates) ?? 'None picked yet.'}</p>
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

        <Card
          title="Beyond work"
          wide
          actions={
            <>
              {status.beyondChanged &&
                claims > 0 &&
                runButton('Add to your fact bank', { skill: 'add-facts', mode: 'new' })}
              <Button size="sm" onClick={() => setEditing('beyond')}>
                Change
              </Button>
              <Button
                size="sm"
                variant="quiet"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={() => {
                  setAddingProject(true);
                  setEditing('beyond');
                }}
              >
                Add a project
              </Button>
            </>
          }
        >
          {projects.length > 0 && <h3 className={styles.cardSubtitle}>Projects and other work</h3>}
          {projects.length > 0 ? (
            <ul className={styles.projects}>
              {projects.map((project) => (
                <li key={project.id} className={styles.project}>
                  <span className={styles.projectName}>
                    {project.name.trim() || 'New project'}
                    <span className={styles.projectLine}>{projectLine(project)}</span>
                  </span>
                  <span className={styles.projectWhat}>{project.what}</span>
                  <ShowingPill showing={project.showing} />
                </li>
              ))}
            </ul>
          ) : null}
          {projects.length > 0 ? (
            <p className={styles.quiet}>
              On resumes: {lowerFirst(placementSummary(answers.projectPrefs))}. Projects page:{' '}
              {labelIn(PAGE_SHAPE_CHOICES, answers.projectPrefs.page).toLowerCase()}.
            </p>
          ) : (
            <p className={styles.quiet}>
              Projects, volunteering and other work outside a job, in any field, and who you are
              outside work. Your Claude turns each project into facts with you.
            </p>
          )}
          {outside.length > 0 && (
            <>
              <h3 className={styles.cardSubtitle}>You, outside work</h3>
              <dl className={styles.outside}>
                {outside.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {status.beyondChanged && claims > 0 && (
            <p className={styles.need}>Changed since your Claude last read it.</p>
          )}
        </Card>

        <Card
          title="For applications"
          actions={
            <Button size="sm" onClick={() => setEditing('applications')}>
              Change
            </Button>
          }
        >
          <p>{applicationsSummary(answers.applications)}</p>
          <p className={styles.quiet}>
            The browser extension fills forms with these. Equal-opportunity answers stay on this
            computer.
          </p>
        </Card>
      </div>

      {profiles && (
        <ProfilesLine
          profiles={profiles.list}
          onAdd={profiles.onAdd}
          onManage={profiles.onManage}
        />
      )}

      {editing && (
        <Dialog
          title={
            {
              about: 'About you',
              applications: 'For applications',
              files: 'What you’ve shared',
              words: 'In your words',
              wants: 'What you want',
              templates: 'Resume templates',
              beyond: 'Beyond work',
            }[editing]
          }
          size="lg"
          onClose={() => {
            void state.flush();
            setEditing(null);
            setAddingProject(false);
          }}
        >
          {(close) => (
            <div className={styles.editor}>
              {editing === 'about' && <AboutYouStep you={answers.you} update={state.update} />}
              {editing === 'applications' && (
                <ApplicationsStep
                  applications={answers.applications}
                  update={state.update}
                  api={api}
                />
              )}
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
              {editing === 'beyond' && (
                <BeyondWorkStep answers={answers} update={state.update} addFirst={addingProject} />
              )}
              {editing === 'templates' && (
                <TemplatesStep
                  answers={answers}
                  templates={profile.templates}
                  update={state.update}
                  api={api}
                  canMake={canRun}
                  onMake={(source) => {
                    // Claude's panel shows it at work. The template joins the gallery once saved.
                    setEditing(null);
                    run({ skill: TEMPLATE_SKILL, source });
                  }}
                />
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
      {xray && filesOf(xray)[0] && (
        <OpenXRay
          api={api}
          files={filesOf(xray)}
          start={(filesOf(xray)[0] as XRayFile).path}
          // A starting resume isn't for one job, so there's no posting to check its terms against.
          posting={null}
          onClose={() => setXray(null)}
        />
      )}
    </main>
  );
}
