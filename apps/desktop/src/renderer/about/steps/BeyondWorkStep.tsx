import {
  Button,
  Checkbox,
  Field,
  Input,
  Pill,
  SegmentedControl,
  Select,
  TagInput,
  TextArea,
} from '@factwright/ui';
import { Lock, Plus, Star } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { type AboutYou, ANSWER_LIMITS, type AnswerChanges } from '../../../shared/about.ts';
import {
  BEYOND_LIMITS,
  INTERESTS_ON_RESUMES,
  labelIn,
  newProject,
  PAGE_SHAPE_CHOICES,
  PROJECT_DETAIL,
  PROJECT_KINDS,
  PROJECT_SHOWING,
  PROJECT_STATUSES,
  type Project,
  type ProjectChange,
  type ProjectPrefs,
  type ProjectShowing,
  projectIdFor,
  RESUME_PLACES,
} from '../../../shared/beyond.ts';
import beyond from './BeyondWorkStep.module.css';
import styles from './steps.module.css';

const options = <T extends string>(list: readonly (readonly [T, string, ...string[]])[]) =>
  list.map(([value, label]) => ({ value, label }));

/** "a, b and c". */
const all = (words: readonly string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/**
 * A project's kind, what it's part of, where it stands and when, in a line: "Open source ·
 * Live or ongoing · 2023".
 */
export const projectLine = (project: Project) =>
  [
    labelIn(PROJECT_KINDS, project.kind),
    project.under.trim(),
    project.status && labelIn(PROJECT_STATUSES, project.status),
    project.when.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

/** How much a project is put forward, as a pill. */
export function ShowingPill({ showing }: { showing: ProjectShowing }) {
  if (showing === 'feature') {
    return (
      <Pill tone="violet">
        <Star size={11} aria-hidden="true" />
        Featured
      </Pill>
    );
  }
  if (showing === 'private') {
    return (
      <Pill tone="slate">
        <Lock size={11} aria-hidden="true" />
        Private
      </Pill>
    );
  }
  return <Pill tone="gray">When it fits</Pill>;
}

/**
 * The user outside work, in a few words, such as "Trail running and chess · Learning Spanish ·
 * Denver Devs", or nothing when they haven't said.
 */
export function outsideSummary(answers: AboutYou): string | null {
  const parts = [
    all(answers.interests.slice(0, 4)),
    answers.learning.length > 0 ? `Learning ${all(answers.learning.slice(0, 3))}` : '',
    all(answers.communities.slice(0, 3)),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The user outside work, a line for each part they've told, as Profile shows it. */
export function outsideLines(answers: AboutYou): [string, string][] {
  const lines: [string, string][] = [
    ['Interests', answers.interests.join(', ')],
    ['Learning', answers.learning.join(', ')],
    ['Communities', answers.communities.join(', ')],
    ['Cares about', answers.cares.trim()],
  ];
  const told = lines.filter(([, value]) => value);
  if (told.length > 0 && answers.interests.length > 0) {
    told.push([
      'Interests line',
      answers.interestsOnResumes === 'never'
        ? 'Left off resumes'
        : answers.interestsOnResumes === 'fit'
          ? 'On resumes when it fits the job'
          : 'On every resume',
    ]);
  }
  return told;
}

/**
 * How projects show on resumes, in a line, such as "In a section called “Selected Work”, a line
 * each, with links and numbers".
 */
export function placementSummary(prefs: ProjectPrefs): string {
  if (prefs.resumes === 'off') return 'Left off';
  const where =
    prefs.resumes === 'experience'
      ? 'As experience'
      : prefs.heading.trim()
        ? `In a section called “${prefs.heading.trim()}”`
        : 'In a section';
  const detail = {
    line: 'a line each',
    lines: 'two lines each',
    paragraph: 'a short paragraph each',
  }[prefs.detail];
  const shown = [prefs.links && 'links', prefs.numbers && 'numbers', prefs.tools && 'tools'].filter(
    (each): each is string => Boolean(each),
  );
  return `${where}, ${detail}${shown.length > 0 ? `, with ${all(shown)}` : ''}`;
}

/** Beyond work in a few words, such as "3 projects, and your interests". */
export function beyondSummary(answers: AboutYou): string | null {
  const count = answers.projects.length;
  const projects = count > 0 ? `${count} project${count === 1 ? '' : 's'}` : '';
  const outside = outsideSummary(answers) || answers.cares.trim() ? 'you outside work' : '';
  const parts = [projects, outside].filter(Boolean);
  return parts.length > 0 ? parts.join(', and ') : null;
}

/** One project: a line to open it, and once open, everything about it. */
function ProjectPanel({
  project,
  open,
  fresh,
  onToggle,
  change,
  onRemove,
}: {
  project: Project;
  open: boolean;
  /** Just added, so its name is the first thing to fill in. */
  fresh: boolean;
  onToggle: () => void;
  change: (fields: Omit<ProjectChange, 'id'>) => void;
  onRemove: () => void;
}) {
  const fieldsId = useId();
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && fresh) nameBox.current?.focus();
  }, [open, fresh]);
  const named = project.name.trim() || 'New project';
  const showing = PROJECT_SHOWING.find(([value]) => value === project.showing);
  return (
    <li className={beyond.project}>
      <div className={beyond.head}>
        <span className={beyond.name}>
          {named}
          <span className={beyond.meta}>{projectLine(project)}</span>
        </span>
        <ShowingPill showing={project.showing} />
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={open}
          aria-controls={fieldsId}
          aria-label={open ? `Done with ${named}` : `Change ${named}`}
          onClick={onToggle}
        >
          {open ? 'Done' : 'Change'}
        </Button>
      </div>
      {open && (
        <div id={fieldsId} className={beyond.body}>
          <div className={styles.fields}>
            <Field label="Name">
              {(control) => (
                <Input
                  {...control}
                  ref={nameBox}
                  maxLength={BEYOND_LIMITS.name}
                  value={project.name}
                  placeholder="Such as Riverside Reading Club"
                  onChange={(event) => change({ name: event.target.value })}
                />
              )}
            </Field>
            <Field label="What kind">
              {(control) => (
                <Select
                  {...control}
                  value={project.kind}
                  onChange={(event) => change({ kind: event.target.value as Project['kind'] })}
                >
                  {PROJECT_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="What it is"
              hint="A line or two, as you’d tell a friend."
              className={styles.wide}
            >
              {(control) => (
                <TextArea
                  {...control}
                  rows={2}
                  maxLength={BEYOND_LIMITS.what}
                  value={project.what}
                  onChange={(event) => change({ what: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Your part in it"
              hint="Such as “Built it alone”, or “Started it, and lead 12 volunteers”."
              className={styles.wide}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={BEYOND_LIMITS.role}
                  value={project.role}
                  onChange={(event) => change({ role: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Part of"
              hint="A company or group it’s under, such as one you run. Projects under one name can show as one job."
              className={styles.wide}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={BEYOND_LIMITS.under}
                  value={project.under}
                  placeholder="Optional"
                  onChange={(event) => change({ under: event.target.value })}
                />
              )}
            </Field>
            <Field label="Where it stands">
              {(control) => (
                <Select
                  {...control}
                  value={project.status}
                  onChange={(event) => change({ status: event.target.value as Project['status'] })}
                >
                  {PROJECT_STATUSES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="When" hint="Such as “2023 to now” or “Spring 2021”.">
              {(control) => (
                <Input
                  {...control}
                  maxLength={BEYOND_LIMITS.when}
                  value={project.when}
                  onChange={(event) => change({ when: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Numbers and results"
              hint="Anything you can count or point to: people who use it, money raised, people helped, awards, press."
              className={styles.wide}
            >
              {(control) => (
                <TextArea
                  {...control}
                  rows={2}
                  maxLength={BEYOND_LIMITS.results}
                  value={project.results}
                  onChange={(event) => change({ results: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Skills and tools"
              hint="Press Enter after each one."
              className={styles.wide}
            >
              {(control) => (
                <TagInput
                  {...control}
                  value={project.skills}
                  max={BEYOND_LIMITS.skills}
                  maxLength={BEYOND_LIMITS.skill}
                  placeholder="Such as fundraising, or Swift"
                  onChange={(skills) => change({ skills })}
                />
              )}
            </Field>
            <Field
              label="Links"
              hint="Its website, app store page, repository or portfolio. Press Enter after each one."
              className={styles.wide}
            >
              {(control) => (
                <TagInput
                  {...control}
                  value={project.links}
                  max={BEYOND_LIMITS.links}
                  maxLength={BEYOND_LIMITS.link}
                  placeholder="Such as example.com"
                  onChange={(links) => change({ links })}
                />
              )}
            </Field>
          </div>
          <div className={beyond.showing}>
            <span className={beyond.showingLabel}>How much to show it</span>
            <SegmentedControl
              label={`How much to show ${named}`}
              options={options(PROJECT_SHOWING)}
              value={project.showing}
              onChange={(value) => change({ showing: value })}
            />
            <p className={styles.note}>{showing?.[2]}</p>
          </div>
          <div>
            <Button size="sm" variant="quiet" onClick={onRemove}>
              Remove this project
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * How projects look on resumes: off, in a section of their own, or listed like jobs, how much
 * each gets, and what each shows. Every job starts from it, and Claude says how it placed them.
 */
function ResumePlacement({
  prefs,
  change,
}: {
  prefs: ProjectPrefs;
  change: (prefs: ProjectPrefs) => void;
}) {
  const place = RESUME_PLACES.find(([value]) => value === prefs.resumes);
  const set = (fields: Partial<ProjectPrefs>) => change({ ...prefs, ...fields });
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>On your resumes</h3>
      <p className={styles.sectionLead}>
        How your projects look on resumes. Each tailored resume starts from this, and your Claude
        says how it placed them, so you can ask for something else for one job. Projects you keep
        private never show. Your website or portfolio, in About you, goes at the top of every
        resume.
      </p>
      <div className={beyond.showing}>
        <span className={beyond.showingLabel}>Where they go</span>
        <SegmentedControl
          label="Where projects go on your resumes"
          options={options(RESUME_PLACES)}
          value={prefs.resumes}
          onChange={(resumes) => set({ resumes })}
        />
        <p className={styles.note}>{place?.[2]}</p>
      </div>
      {prefs.resumes !== 'off' && (
        <>
          {prefs.resumes === 'section' && (
            <Field
              label="The section’s heading"
              hint="In your words, such as Projects, Selected Work or Volunteer Work. Leave it blank and your Claude names it for the job."
            >
              {(control) => (
                <Input
                  {...control}
                  className={beyond.heading}
                  maxLength={BEYOND_LIMITS.heading}
                  value={prefs.heading}
                  placeholder="Projects"
                  onChange={(event) => set({ heading: event.target.value })}
                />
              )}
            </Field>
          )}
          <div className={beyond.showing}>
            <span className={beyond.showingLabel}>How much for each</span>
            <SegmentedControl
              label="How much each project gets"
              options={options(PROJECT_DETAIL)}
              value={prefs.detail}
              onChange={(detail) => set({ detail })}
            />
          </div>
          <fieldset className={beyond.choices}>
            <legend className={beyond.showingLabel}>What each shows</legend>
            <Checkbox
              label="Its link"
              checked={prefs.links}
              onChange={(event) => set({ links: event.target.checked })}
            />
            <Checkbox
              label="Its numbers"
              checked={prefs.numbers}
              onChange={(event) => set({ numbers: event.target.checked })}
            />
            <Checkbox
              label="Its tools"
              checked={prefs.tools}
              onChange={(event) => set({ tools: event.target.checked })}
            />
          </fieldset>
        </>
      )}
    </div>
  );
}

/**
 * How a Projects page lays the projects out, when the user has their Claude make one for a job.
 * It's made only when they ask, and goes only where they send it.
 */
function PagePlacement({
  prefs,
  change,
}: {
  prefs: ProjectPrefs;
  change: (prefs: ProjectPrefs) => void;
}) {
  const shape = PAGE_SHAPE_CHOICES.find(([value]) => value === prefs.page);
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Projects page</h3>
      <p className={styles.sectionLead}>
        For a job your projects help with, your Claude can make a one-page Projects page in your
        resume’s look, from the job’s Projects page button. It goes only where you send it, such as
        an application’s portfolio upload, an email or an interview.
      </p>
      <div className={beyond.showing}>
        <span className={beyond.showingLabel}>How it lays them out</span>
        <SegmentedControl
          label="How a Projects page lays out your projects"
          options={options(PAGE_SHAPE_CHOICES)}
          value={prefs.page}
          onChange={(page) => change({ ...prefs, page })}
        />
        <p className={styles.note}>{shape?.[2]}</p>
      </div>
    </div>
  );
}

/**
 * Work outside a job, and the user outside work. Projects are anything they made, led or kept
 * going outside a job, in any field, each an overview Claude turns into facts with them. The rest
 * is who they are outside work, which answers to "tell us about yourself" and their cover
 * letters' voice draw on, and a resume shows only as they say.
 */
export function BeyondWorkStep({
  answers,
  update,
  addFirst = false,
  later = false,
}: {
  answers: AboutYou;
  update: (changes: AnswerChanges) => void;
  /** Starts with a new project open, as when the user asked to add one. */
  addFirst?: boolean;
  /** Whether it's part of getting started, where it can be skipped and filled in later. */
  later?: boolean;
}) {
  const titleId = useId();
  const [open, setOpen] = useState<string | null>(null);
  // The project just added, whose name is the next thing to fill in.
  const [fresh, setFresh] = useState<string | null>(null);
  const addedFirst = useRef(false);

  const add = () => {
    const id = projectIdFor(
      `project-${answers.projects.length + 1}`,
      answers.projects.map((project) => project.id),
    );
    update({ addedProjects: [newProject(id)] });
    setOpen(id);
    setFresh(id);
  };

  // Opened to add a project: one is added, once.
  useEffect(() => {
    if (!addFirst || addedFirst.current) return;
    addedFirst.current = true;
    add();
  }, [addFirst]);

  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Beyond work
        </h2>
        <p className={styles.lead}>
          Projects, volunteering and the rest of you. Anything you’ve made, led or kept going
          outside a job counts: an app, a club you run, research, art, a small business, a course
          project.
          {later && ' Skip anything that doesn’t apply; you can add it later in Profile.'}
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Projects and other work</h3>
        <p className={styles.sectionLead}>
          A few lines on each is plenty. Your Claude asks you about the rest and turns each one into
          facts, and nothing goes out until you verify it.
        </p>
        {answers.projects.length > 0 && (
          <ul className={beyond.projects}>
            {answers.projects.map((project) => (
              <ProjectPanel
                key={project.id}
                project={project}
                open={open === project.id}
                fresh={fresh === project.id}
                onToggle={() => {
                  setOpen(open === project.id ? null : project.id);
                  setFresh(null);
                }}
                change={(fields) => update({ projectChanges: [{ id: project.id, ...fields }] })}
                onRemove={() => {
                  update({ removedProjects: [project.id] });
                  setOpen(null);
                }}
              />
            ))}
          </ul>
        )}
        <div>
          <Button
            icon={<Plus size={16} aria-hidden="true" />}
            disabled={answers.projects.length >= BEYOND_LIMITS.projects}
            onClick={add}
          >
            Add a project
          </Button>
        </div>
      </div>

      {!later && (
        <ResumePlacement
          prefs={answers.projectPrefs}
          change={(projectPrefs) => update({ projectPrefs })}
        />
      )}
      {!later && (
        <PagePlacement
          prefs={answers.projectPrefs}
          change={(projectPrefs) => update({ projectPrefs })}
        />
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>You, outside work</h3>
        <p className={styles.sectionLead}>
          Your Claude uses this when a form asks about you or your hobbies, to sound like you in a
          cover letter, for small talk before an interview, and to find people who share a community
          with you. Leave out anything you’d rather an employer not know.
        </p>
        <div className={styles.fields}>
          <Field label="Interests and hobbies" hint="Press Enter after each one.">
            {(control) => (
              <TagInput
                {...control}
                value={answers.interests}
                max={ANSWER_LIMITS.entries}
                maxLength={ANSWER_LIMITS.entry}
                placeholder="Such as trail running"
                onChange={(interests) => update({ interests })}
              />
            )}
          </Field>
          <Field label="What you’re learning" hint="Skills, languages, or ways you’re growing.">
            {(control) => (
              <TagInput
                {...control}
                value={answers.learning}
                max={ANSWER_LIMITS.entries}
                maxLength={ANSWER_LIMITS.entry}
                placeholder="Such as Spanish"
                onChange={(learning) => update({ learning })}
              />
            )}
          </Field>
          <Field
            label="Communities you’re part of"
            hint="Such as a meetup, a sports league or a volunteer group."
            className={styles.wide}
          >
            {(control) => (
              <TagInput
                {...control}
                value={answers.communities}
                max={ANSWER_LIMITS.entries}
                maxLength={ANSWER_LIMITS.entry}
                placeholder="Such as Denver Devs meetup (organizer)"
                onChange={(communities) => update({ communities })}
              />
            )}
          </Field>
          <Field
            label="What you care about"
            hint="Causes, values, or the kind of work that matters to you."
            className={styles.wide}
          >
            {(control) => (
              <TextArea
                {...control}
                rows={3}
                maxLength={ANSWER_LIMITS.text}
                value={answers.cares}
                onChange={(event) => update({ cares: event.target.value })}
              />
            )}
          </Field>
        </div>
        <div className={beyond.showing}>
          <span className={beyond.showingLabel}>A line of your interests on resumes</span>
          <SegmentedControl
            label="A line of your interests on resumes"
            options={options(INTERESTS_ON_RESUMES)}
            value={answers.interestsOnResumes}
            onChange={(interestsOnResumes) => update({ interestsOnResumes })}
          />
        </div>
      </div>
    </section>
  );
}
