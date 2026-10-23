import type { Job, JobFile } from '@factwright/core';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ClaudeButton, isRunning } from './ClaudeButton.tsx';
import styles from './CoverLetter.module.css';
import { FileRow } from './JobFiles.tsx';
import panel from './JobPanel.module.css';
import { Part, Placeholder } from './PanelSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';
import type { RunControls } from './RunActions.tsx';

/** What a Projects page shows, as the panel lists it: its heading, shape and projects. */
interface PageOutline {
  heading: string;
  shape: string;
  projects: string[];
}

const SHAPES: Readonly<Record<string, string>> = {
  list: 'a list',
  cards: 'cards',
  'case-studies': 'case studies',
};

/**
 * A job's Projects page, from its projects-page.json, or null when there's none or it won't
 * read. The engine checks a page properly before it's built. This only reads what there is to
 * show, so a page half written shows what it has.
 */
export function readPageOutline(json: string | null | undefined): PageOutline | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  const projects = (Array.isArray(page.projects) ? page.projects : []).flatMap((project) => {
    const name = (project as Record<string, unknown> | null)?.name;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
  if (projects.length === 0) return null;
  return {
    heading:
      typeof page.heading === 'string' && page.heading.trim() ? page.heading.trim() : 'Projects',
    shape:
      typeof page.shape === 'string' && Object.hasOwn(SHAPES, page.shape) ? page.shape : 'list',
    projects,
  };
}

/**
 * The job's Projects page, once Claude has made one: what's on it, and its files to preview, or
 * open and attach. It goes only where the user sends it. Before there's one, for a posting that
 * asks for samples of the user's work, the button that makes it.
 */
export function ProjectsPagePart({
  job,
  api,
  today,
  run,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
  run: RunControls | undefined;
}) {
  const [outline, setOutline] = useState<PageOutline | null>(null);
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const written = job.docKinds.includes('projects');

  // The page comes from projects-page.json, which changes the job list when it's saved.
  useEffect(() => {
    let live = true;
    if (!written) {
      setOutline(null);
      return;
    }
    void api.jobDocs(job.id).then((docs) => {
      if (live) setOutline(readPageOutline(docs?.projects));
    });
    return () => {
      live = false;
    };
  }, [api, job, written]);

  const task: RunTask = { skill: 'projects-page', jobId: job.id };
  // Whether Claude is making it now, so what shows isn't checked yet.
  const making = isRunning(run, task);
  if (!outline && job.projectPages.length === 0) {
    return (
      <Placeholder
        title="Projects page"
        action={<ClaudeButton run={run} task={task} label="Make a Projects page" adds />}
      >
        The posting asks for samples of your work. A Projects page shows your projects in depth, on
        one page, to send with your application.
      </Placeholder>
    );
  }
  const count = outline?.projects.length ?? 0;
  const summary = making
    ? 'Being made'
    : outline
      ? `${count} project${count === 1 ? '' : 's'}, as ${SHAPES[outline.shape]}`
      : null;

  const open = async (path: string) => {
    const result = await api.openFile(path);
    setProblem(result.ok ? null : result.message);
  };

  return (
    <Part
      title="Projects page"
      summary={summary}
      actions={<ClaudeButton run={run} task={task} label="New version" />}
    >
      {making && (
        <p className={`${panel.quiet} ${styles.writing}`}>
          Your Claude is still making and checking this page.
        </p>
      )}
      {outline && (
        <p>
          <strong>{outline.heading}:</strong> {outline.projects.join(' · ')}
        </p>
      )}
      <p className={styles.hint}>
        It goes only where you send it: an application’s portfolio or other files, an email, or an
        interview.
      </p>
      {job.projectPages.length > 0 && (
        <ul className={`${panel.files} ${styles.files}`} aria-label="The Projects page’s files">
          {job.projectPages.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              today={today}
              onPreview={setPreview}
              onOpen={open}
            />
          ))}
        </ul>
      )}
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
      {preview && <ResumePreview file={preview} api={api} onClose={() => setPreview(null)} />}
    </Part>
  );
}
