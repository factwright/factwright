import { type Job, type OutreachDraft, shortDate } from '@factwright/core';
import { Markdown } from '@factwright/ui';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
// The drafts open and close as the user's questions for Claude do.
import styles from './AskSection.module.css';
import { ClaudeButton } from './ClaudeButton.tsx';
import panel from './JobPanel.module.css';
import { PanelSection, Placeholder } from './PanelSection.tsx';
import type { RunControls } from './RunActions.tsx';

/** A draft's title, from its first heading, and the rest of it to read. */
function draftParts(text: string): { title: string | null; body: string } {
  const heading = text.match(/^#[ \t]+(.+)\r?\n/);
  return heading?.[1]
    ? { title: heading[1].trim(), body: text.slice(heading[0].length).trim() }
    : { title: null, body: text };
}

/**
 * People worth messaging at the job's company, as Claude found them: who each one is, why them,
 * and a short draft the user sends themselves. Before there are any, what Claude does and the
 * button that starts it.
 */
export function PeopleSection({
  job,
  api,
  today,
  run,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
  run?: RunControls | undefined;
}) {
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);

  // Claude saves its drafts in the workspace, which changes the job list, so they follow it.
  useEffect(() => {
    let live = true;
    if (job.outreach.length === 0) {
      setDrafts([]);
      return;
    }
    void api.jobExtras(job.id).then((extras) => {
      if (live) setDrafts(extras?.outreach ?? []);
    });
    return () => {
      live = false;
    };
  }, [api, job]);

  const task: RunTask = { skill: 'who-to-message', jobId: job.id };
  const empty = job.outreach.length === 0;
  const newest = drafts[0]?.date;

  return (
    <PanelSection
      id="people"
      title="People to contact"
      icon={<Users size={15} />}
      summary={newest ? `Found ${shortDate(newest, today)}` : undefined}
      count={job.outreach.length}
      empty={empty}
      actions={!empty && <ClaudeButton run={run} task={task} label="Find more" />}
    >
      {empty ? (
        <Placeholder
          action={<ClaudeButton run={run} task={task} label="Find people to message" adds />}
        >
          Your Claude finds a few people worth messaging at {job.company}, says why each one, and
          drafts a short note for you to send yourself.
        </Placeholder>
      ) : (
        <>
          <p className={panel.quiet}>Only you send these. Your Claude never messages anyone.</p>
          <ul className={styles.asks}>
            {drafts.map((draft, i) => {
              const { title, body } = draftParts(draft.text);
              return (
                <li key={draft.path} className={styles.ask}>
                  <details className={styles.details} open={i === 0}>
                    <summary className={styles.summary}>
                      <span className={styles.asked}>{title ?? 'People to message'}</span>
                      {draft.date && (
                        <span className={styles.meta}>{shortDate(draft.date, today)}</span>
                      )}
                    </summary>
                    <div className={`${styles.body} ${styles.answer}`}>
                      <Markdown text={body} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PanelSection>
  );
}
