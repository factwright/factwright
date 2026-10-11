import { FIT_TIERS, JOB_STATUSES, type JobStatus } from '@factwright/core';
import { BookOpen, Briefcase, FileText, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Checkbox,
  Chip,
  DARK,
  Dialog,
  DialogActions,
  Field,
  FitBadge,
  IconButton,
  Input,
  LIGHT,
  Markdown,
  MoodBadge,
  NavItem,
  Notice,
  type Palette,
  RUN_STATES,
  RunStatus,
  ScoreBar,
  SearchField,
  SegmentedControl,
  Select,
  Stat,
  StatusPill,
  StatusSelect,
  TextArea,
  ThemeStyle,
} from '../src/index.ts';
import styles from './gallery.module.css';

const SWATCHES: (keyof Palette)[] = [
  'bg',
  'surface',
  'text',
  'muted',
  'accent',
  'need',
  'ok',
  'bad',
];

const SAMPLE_SCORES = { strong: 86, good: 78, worth: 64, long: 41, skip: 22 } as const;

const VIEWS = [
  { value: 'active', label: 'Active', count: 7 },
  { value: 'review', label: 'To review', count: 1 },
  { value: 'applied', label: 'Applied', count: 4 },
  { value: 'closed', label: 'Closed', count: 11 },
] as const;

type View = (typeof VIEWS)[number]['value'];

const SAMPLE_DOCUMENT = `# Staff Engineer, Developer Tools

Acme Robotics builds the tools **every** engineer uses. See [the team page](https://acme.example/team).

## What you'll do
- Own the build and CI system
  - Cut build times
  - Keep it reliable
- Mentor engineers on the platform team

> Remote in the US, with a trip to Denver each quarter.

| Part | Points |
|---|---|
| Work | 33 of 40 |
| Stack | 14 of 20 |
`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function TypeSample({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={styles.typeSample}>
      <span>{name}</span>
      <span className={className}>{children}</span>
    </p>
  );
}

/** Every component, in whichever theme the column around it sets. */
function Showcase({ name, palette }: { name: string; palette: Palette }) {
  const [view, setView] = useState<View>('active');
  const [status, setStatus] = useState<JobStatus>('applied');
  const [strong, setStrong] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <Section title="Colors">
        <div className={styles.swatches}>
          {SWATCHES.map((swatch) => (
            <div key={swatch} className={styles.swatch}>
              <div className={styles.chip} style={{ background: palette[swatch] }} />
              <span>{swatch}</span>
              <code>{palette[swatch]}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <TypeSample name="Page title · 22" className={styles.pageTitle}>
          Jobs
        </TypeSample>
        <TypeSample name="Job title · 20" className={styles.jobTitle}>
          Staff Engineer, Developer Tools
        </TypeSample>
        <TypeSample name="Section · 13.5" className={styles.sectionTitle}>
          Why it scored 78
        </TypeSample>
        <TypeSample name="Body · 14">
          Apply on their careers page. Have a short note about a tool you built.
        </TypeSample>
        <TypeSample name="Small · 12.5" className={styles.small}>
          From the fit check · today
        </TypeSample>
        <TypeSample name="Claude’s panel · 13" className={styles.mono}>
          ⏺ Read the posting and your fact bank
        </TypeSample>
      </Section>

      <Section title="Buttons">
        <div className={styles.row}>
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
            Add job
          </Button>
          <Button>Find jobs</Button>
          <Button variant="quiet">Hide</Button>
          <IconButton label="Settings" icon={<SlidersHorizontal size={16} aria-hidden="true" />} />
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="sm">
            Open resume
          </Button>
          <Button size="sm">Log a call</Button>
          <Button variant="quiet" size="sm">
            Stop
          </Button>
          <Button disabled>Run</Button>
        </div>
      </Section>

      <Section title="Search and views">
        <SearchField
          className={styles.search}
          label="Search jobs, companies and notes"
          shortcut="⌘K"
        />
        <SegmentedControl label="Views" options={VIEWS} value={view} onChange={setView} />
      </Section>

      <Section title="Sidebar">
        <nav className={styles.nav} aria-label={`Sample sidebar, ${name}`}>
          <NavItem
            icon={<Briefcase size={16} aria-hidden="true" />}
            label="Jobs"
            count={18}
            current
          />
          <NavItem icon={<Search size={16} aria-hidden="true" />} label="Job searches" />
          <NavItem icon={<BookOpen size={16} aria-hidden="true" />} label="Fact bank" />
          <NavItem icon={<FileText size={16} aria-hidden="true" />} label="Resumes" />
        </nav>
      </Section>

      <Section title="Job status">
        <div className={styles.row}>
          {JOB_STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Status menu">
        <div className={styles.row}>
          <StatusSelect status={status} label={`Status, ${name}`} onChange={setStatus} />
        </div>
      </Section>

      <Section title="Forms">
        <div className={styles.form}>
          <Field label="Next step" hint="With a date, it shows in Needs you when it’s due.">
            {(control) => <Input {...control} defaultValue="Prepare questions about the team" />}
          </Field>
          <Field label="Date">
            {(control) => <Input {...control} type="date" defaultValue="2026-10-12" />}
          </Field>
          <Field label="Kind">
            {(control) => (
              <Select {...control} defaultValue="technical">
                <option value="screen">Recruiter screen</option>
                <option value="technical">Technical interview</option>
              </Select>
            )}
          </Field>
          <Field label="Your notes">
            {(control) => <TextArea {...control} defaultValue="Dana is the recruiter." />}
          </Field>
          <Checkbox label="Show archived jobs" />
        </div>
        <div className={styles.row}>
          <Chip pressed={strong} tone="green" onClick={() => setStrong(!strong)}>
            Strong
          </Chip>
          <Chip pressed={false}>Long shot</Chip>
          <Button onClick={() => setDialogOpen(true)}>Open a dialog</Button>
        </div>
        {dialogOpen && (
          <Dialog
            title="Add a job"
            description="For a job you found yourself. Your Claude can check it later."
            onClose={() => setDialogOpen(false)}
          >
            <Field label="Company">
              {(control) => <Input {...control} defaultValue="Fernway" />}
            </Field>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary">Add job</Button>
            </DialogActions>
          </Dialog>
        )}
      </Section>

      <Section title="Fit">
        <div className={styles.row}>
          {FIT_TIERS.map((tier) => (
            <FitBadge key={tier} score={SAMPLE_SCORES[tier]} tier={tier} />
          ))}
          <FitBadge />
        </div>
      </Section>

      <Section title="Why it scored">
        <ScoreBar label="Work" points={33} max={40}>
          Build and CI tooling for hundreds of engineers
        </ScoreBar>
        <ScoreBar label="Stack" points={14} max={20}>
          Go and TypeScript match; Rust would be new
        </ScoreBar>
      </Section>

      <Section title="What people say">
        <div className={styles.row}>
          <MoodBadge mood="loved" />
          <MoodBadge mood="mixed" />
          <MoodBadge mood="disliked" />
          <MoodBadge mood="thin" />
        </div>
      </Section>

      <Section title="Documents">
        <Markdown text={SAMPLE_DOCUMENT} />
      </Section>

      <Section title="Claude’s status">
        <div className={styles.row}>
          {RUN_STATES.map((state) => (
            <RunStatus key={state} state={state} />
          ))}
        </div>
      </Section>

      <Section title="Stats">
        <div className={styles.stats}>
          <Stat label="In play" value="4" detail="1 interview · 1 screen" />
          <Stat label="Heard back" value="47%" detail="7 of 15 applications" />
          <Stat label="Needs you" value="2" detail="1 follow-up · 1 new job" tone="need" />
        </div>
      </Section>

      <Section title="Notices">
        <Notice title="How to apply">
          Apply on their careers page. The form asks for a short note about a tool you built.
        </Notice>
        <Notice title="Good to know" tone="info">
          Factwright runs your own Claude Code and never sees your Claude login.
        </Notice>
      </Section>
    </>
  );
}

function Gallery() {
  return (
    <>
      <ThemeStyle />
      <header className={styles.header}>
        <h1>Factwright design system</h1>
        <p>Every color, type size and part, in light and dark.</p>
      </header>
      <main className={styles.columns}>
        <section className={styles.column} data-theme="light" aria-labelledby="light">
          <h2 id="light">Light</h2>
          <Showcase name="light" palette={LIGHT} />
        </section>
        <section className={styles.column} data-theme="dark" aria-labelledby="dark">
          <h2 id="dark">Dark</h2>
          <Showcase name="dark" palette={DARK} />
        </section>
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
