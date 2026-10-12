import { Button, Checkbox, Dialog, DialogActions } from '@factwright/ui';
import { useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { ClaudePermissions } from '../shared/permissions.ts';
import styles from './PermissionsDialog.module.css';

/**
 * What Claude may do on the job hunt without asking. It always saves its work and reads postings
 * on the applicant systems; the user chooses whether it also changes their other files, and
 * reads any website, without asking. Each choice saves as it's made.
 */
export function PermissionsDialog({
  api,
  onClose,
}: {
  api: Pick<FactwrightApi, 'claudePermissions' | 'setClaudePermissions'>;
  onClose: () => void;
}) {
  const [permissions, setPermissions] = useState<ClaudePermissions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const filesHint = useId();
  const sitesHint = useId();

  useEffect(() => {
    void api.claudePermissions().then(setPermissions);
  }, [api]);

  const change = async (next: ClaudePermissions) => {
    setPermissions(next);
    try {
      setPermissions(await api.setClaudePermissions(next));
      setProblem(null);
    } catch {
      setProblem('That didn’t save. Try again.');
      setPermissions(await api.claudePermissions());
    }
  };

  return (
    <Dialog title="What Claude can do without asking" onClose={onClose}>
      <p className={styles.lead}>
        Claude works only in your job hunt, and can’t run programs on your computer. It always
        searches the web, reads postings on Greenhouse, Lever, Ashby and Gem, and saves its work in
        your jobs’ folders, job searches and outreach drafts without asking.
      </p>
      {permissions && (
        <div className={styles.options}>
          <div>
            <Checkbox
              label="Change any file in your job hunt"
              checked={permissions.anyFile}
              aria-describedby={filesHint}
              onChange={(event) => void change({ ...permissions, anyFile: event.target.checked })}
            />
            <p id={filesHint} className={styles.hint}>
              Including your facts, guide and base resumes, which every resume and answer is built
              from. When this is off, Claude asks before changing them.
            </p>
          </div>
          <div>
            <Checkbox
              label="Read any website"
              checked={permissions.anySite}
              aria-describedby={sitesHint}
              onChange={(event) => void change({ ...permissions, anySite: event.target.checked })}
            />
            <p id={sitesHint} className={styles.hint}>
              When this is off, Claude asks before reading other sites, such as a company’s careers
              page. A job post could try to trick Claude into sending your details to a site, and
              asking lets you catch it.
            </p>
          </div>
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <p className={styles.note}>Changes apply the next time Claude starts.</p>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
