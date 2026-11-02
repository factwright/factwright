import { Button, Dialog, DialogActions, Field, TextArea } from '@factwright/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import {
  CHANGES_QUESTION,
  PART_NAMES,
  PROFILE_SKILL,
  type ProfilePart,
} from '../../shared/profile-parts.ts';
import type { RunTask } from '../../shared/runs.ts';
import { MAX_CHANGES } from '../../shared/versions.ts';
import { ClaudeButton } from '../jobs/ClaudeButton.tsx';
import type { RunControls } from '../jobs/RunActions.tsx';
import styles from './UpdateWithClaude.module.css';

/** What each part's run changes, as the end of "Your Claude changes…", and an example to start from. */
const PARTS: Readonly<Record<ProfilePart, { changes: string; example: string; leftOut?: string }>> =
  {
    wants: {
      changes:
        'what you want: each kind of job with its titles, work, levels and pay, where you’d work, companies, terms, must-haves and deal-breakers',
      example:
        'Such as: add staff roles, leave out on-site jobs, and raise my lowest pay to $150,000',
    },
    kind: {
      changes: 'this kind of job’s name, titles, kinds of work, levels and pay',
      example: 'Such as: add program director roles, and aim for $170,000',
      leftOut: 'What every kind shares, such as where you’d work, is in What you want.',
    },
    leaving: {
      changes: 'what forms get when they ask why you’re leaving',
      example: 'Such as: make it sound more positive, and say the team was cut in half',
      leftOut:
        'Your street, postal code and equal-opportunity answers stay on this computer, and your Claude never sees them. Leave them out of what you type here. For applications’ Change has them.',
    },
    beyond: {
      changes:
        'your projects, how they look on resumes and a Projects page, and who you are outside work',
      example: 'Such as: Trailhead is finished now, and add my Saturday reading club as a project',
    },
    history: {
      changes: 'each job and school',
      example: 'Such as: add my 2015 internship at Acme, and I left Tidewater in March',
    },
    resumes: {
      changes: 'your starting resumes, from your verified facts',
      example: 'Such as: lead with the platform work, and keep them to one page',
      leftOut:
        'Facts still waiting to be verified stay off them until you verify them. Update your fact bank to add one.',
    },
    templates: {
      changes:
        'which templates you use, how long resumes run, which files they come as, and the look of your own templates',
      example: 'Such as: use Minimal for startups, and make my Navy Sidebar’s headings darker',
      leftOut: 'To copy the look of a resume you like, add it in Change.',
    },
    facts: {
      changes: 'your fact bank: what you say goes in as you say it, for you to verify',
      example: 'Such as: the billing rewrite went live in March, and it cut costs about 20%',
      leftOut:
        'Your Claude asks before it changes a verified fact. Removing a fact stays with you, in the Fact bank.',
    },
  };

/**
 * Update with Claude, for one part of Profile, whether it's empty or full: the user says what to
 * change in their own words, which the app holds for the run, never typed into it, and a run
 * changes that part and nothing else. Clicked while Claude has another task on Profile, it waits in
 * line. It says what's left out of that part, so nothing's hidden.
 */
export function UpdateWithClaude({
  part,
  kind,
  name,
  api,
  run,
  quiet = false,
  onBefore,
}: {
  part: ProfilePart;
  /** The kind of job, by its id, for the part that's one kind. */
  kind?: string;
  /** The part's name, for one that goes by its own, such as a kind of job's. */
  name?: string;
  api: Pick<FactwrightApi, 'requestProfileChanges'>;
  /** Claude's runs, or nothing until Claude Code is ready. */
  run: RunControls | undefined;
  /** A lighter button, for a line of a card that has its own already. */
  quiet?: boolean;
  /** Saves anything still waiting, before Claude reads what's there. */
  onBefore?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const shown = name ?? PART_NAMES[part];
  // To say where a task on this part stands: which request it's for makes no difference.
  const task: RunTask = { skill: PROFILE_SKILL, part, ...(kind && { kind }), request: '' };
  return (
    <>
      <ClaudeButton
        run={run}
        task={task}
        label="Update with Claude"
        quiet={quiet}
        // The card or line it's on says what it's for, but a screen reader may be elsewhere.
        ariaLabel={`Update with Claude: ${shown}`}
        onStart={() => setOpen(true)}
      />
      {open && (
        <UpdateDialog
          part={part}
          kind={kind}
          name={shown}
          api={api}
          // Claude Code can stop being ready while the dialog's open, which says so.
          ready={run !== undefined}
          onAsked={(request) => {
            setOpen(false);
            run?.start({ ...task, request });
          }}
          onBefore={onBefore}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** What the user wants changed, in their own words, and the button that asks Claude for it. */
function UpdateDialog({
  part,
  kind,
  name,
  api,
  ready,
  onAsked,
  onBefore,
  onClose,
}: {
  part: ProfilePart;
  kind: string | undefined;
  name: string;
  api: Pick<FactwrightApi, 'requestProfileChanges'>;
  ready: boolean;
  onAsked: (request: string) => void;
  onBefore: (() => Promise<void>) | undefined;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const words = PARTS[part];
  // Closed while it's saving what's waiting, nothing starts.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const ask = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (!changes.trim()) return;
    if (!ready) {
      setProblem('Your Claude isn’t ready. The card in the sidebar says what to do.');
      return;
    }
    setAsking(true);
    let result: Awaited<ReturnType<typeof api.requestProfileChanges>>;
    try {
      await onBefore?.();
      result = await api.requestProfileChanges({ part, ...(kind && { kind }), changes });
    } catch {
      result = { ok: false, message: 'That didn’t reach your Claude. Try again.' };
    }
    if (!open.current) return;
    setAsking(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    close();
    onAsked(result.request);
  };
  return (
    <Dialog
      title={`Update with Claude: ${name}`}
      description={`Your Claude changes ${words.changes}, and nothing else. Its task lists each change, with Undo.`}
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => void ask(event, close)}>
          <Field label={CHANGES_QUESTION}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.changes}
                placeholder={words.example}
                rows={4}
                maxLength={MAX_CHANGES}
                value={changes}
                onChange={(event) => setChanges(event.target.value)}
                data-autofocus
              />
            )}
          </Field>
          {words.leftOut && <p className={styles.leftOut}>{words.leftOut}</p>}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={asking || !changes.trim()}>
              Make the changes
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
