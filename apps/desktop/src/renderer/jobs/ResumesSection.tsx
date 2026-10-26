import { asksForWorkSamples, type Job, type JobFile } from '@factwright/core';
import { FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { DocVersion } from '../../shared/versions.ts';
import { OpenXRay } from '../xray/OpenXRay.tsx';
import { ClaudeButton, isComing } from './ClaudeButton.tsx';
import { CoverLetterPart } from './CoverLetterSection.tsx';
import { FileRow, fileActions } from './JobFiles.tsx';
import panel from './JobPanel.module.css';
import { PanelSection, Part, Placeholder } from './PanelSection.tsx';
import { ProjectsPagePart } from './ProjectsPageSection.tsx';
import { ResumePreview } from './ResumePreview.tsx';
import type { RunControls } from './RunActions.tsx';
import { EarlierVersions, NewVersionButton, RequestChanges, SentPill } from './Versions.tsx';

/** A file's name without its extension, which a resume's PDF and Word file share. */
const stem = (name: string) => name.replace(/\.(?:pdf|docx)$/i, '');

/** How many documents files make, counting a PDF and a Word file of one as one. */
const named = (files: readonly JobFile[]) => new Set(files.map((file) => stem(file.name))).size;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Tailor a resume, and Quick resume beside it, which asks the user nothing and uses verified facts
 * only. While either runs, or waits in line, one button says so.
 */
function FirstResume({ run, jobId }: { run: RunControls | undefined; jobId: string }) {
  const tailored: RunTask = { skill: 'focused-resume', jobId };
  const tailor = <ClaudeButton run={run} task={tailored} label="Tailor a resume" adds />;
  if (isComing(run, tailored)) return tailor;
  const quick: RunTask = { skill: 'focused-resume', jobId, quick: true };
  return (
    <>
      {tailor}
      <ClaudeButton run={run} task={quick} label="Quick resume" adds />
    </>
  );
}

/**
 * What the user sends with an application: the job's resume, to preview, X-ray and attach, and its
 * cover letter, each with a New version, or the button that makes the first one. The resume has a
 * quick one beside each, which asks the user nothing. A Projects page
 * shows too, for a posting that asks for samples of the user's work. A resume's X-ray can send
 * what it found for revision, with Claude's panel.
 */
export function ResumesSection({
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
  const [preview, setPreview] = useState<JobFile | null>(null);
  const [xray, setXray] = useState<JobFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The earlier versions, read again whenever the job changes, as a new version or a sync does.
  const [versions, setVersions] = useState<DocVersion[]>([]);
  useEffect(() => {
    let live = true;
    void api.jobExtras(job.id).then((extras) => {
      if (live) setVersions(extras?.versions ?? []);
    });
    return () => {
      live = false;
    };
  }, [api, job]);

  // The X-ray checks a job's resume against its posting. Older folders keep it in the job notes,
  // and a job saved from the browser may have only the posting the user saved there.
  const posting = useCallback(async () => {
    const [loaded, extras] = await Promise.all([api.jobDocs(job.id), api.jobExtras(job.id)]);
    return loaded?.posting ?? extras?.posting?.text ?? loaded?.job ?? null;
  }, [api, job.id]);
  /** A resume's PDF and Word file, which share a name, for the X-ray to switch between. */
  const sameResume = (file: JobFile) =>
    job.files.filter((each) => stem(each.name) === stem(file.name));
  const actions = fileActions(api, job.id, setProblem);

  const letter = job.letters.length > 0 || job.docKinds.includes('letter');
  const page = job.projectPages.length > 0 || job.docKinds.includes('projects');
  const empty = job.files.length === 0 && !letter && !page;
  const summary = [
    job.files.length > 0 && count(named(job.files), 'resume'),
    job.letters.length > 0 && count(named(job.letters), 'cover letter'),
    job.projectPages.length > 0 && count(named(job.projectPages), 'Projects page'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PanelSection
      id="files"
      title="Resumes and cover letters"
      icon={<FileText size={15} />}
      summary={summary}
      count={named(job.files) + named(job.letters) + named(job.projectPages)}
      empty={empty}
    >
      {job.files.length === 0 ? (
        <Placeholder title="Resume" action={<FirstResume run={run} jobId={job.id} />}>
          A resume for this job, every line traced to a fact.
        </Placeholder>
      ) : (
        <Part
          title="Resume"
          summary={<SentPill job={job} kind="resume" />}
          actions={
            <>
              <RequestChanges job={job} kind="resume" api={api} run={run} />
              <NewVersionButton
                job={job}
                kind="resume"
                api={api}
                run={run}
                onProblem={setProblem}
              />
            </>
          }
        >
          <ul className={panel.files} aria-label="The resume’s files">
            {job.files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                today={today}
                onPreview={setPreview}
                actions={actions}
                onXRay={setXray}
              />
            ))}
          </ul>
          <EarlierVersions
            job={job}
            kind="resume"
            versions={versions}
            api={api}
            today={today}
            onPreview={setPreview}
            onProblem={setProblem}
          />
        </Part>
      )}
      <CoverLetterPart job={job} api={api} today={today} run={run} versions={versions} />
      {(page || asksForWorkSamples(job)) && (
        <ProjectsPagePart job={job} api={api} today={today} run={run} versions={versions} />
      )}
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
      {preview && (
        <ResumePreview file={preview} api={api} job={job} onClose={() => setPreview(null)} />
      )}
      {xray && (
        <OpenXRay
          api={api}
          files={sameResume(xray)}
          start={xray.path}
          posting={posting}
          revise={{
            jobId: job.id,
            // A revision keeps the resume's version first, so it waits for the job's other tasks.
            busy: run ? run.tasksOn(job.id).length > 0 : false,
            start: run?.start ?? null,
          }}
          onClose={() => setXray(null)}
        />
      )}
    </PanelSection>
  );
}
