import { Button, EmptyState } from '@factwright/ui';
import { Briefcase } from 'lucide-react';
import styles from './JobsPage.module.css';

/** The jobs page. Until the job list is built, it lets the user start their Claude directly. */
export function JobsPage({
  canStartClaude,
  onStartClaude,
}: {
  canStartClaude: boolean;
  onStartClaude: () => void;
}) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Jobs</h1>
      <EmptyState
        title="No jobs yet"
        icon={<Briefcase size={20} aria-hidden="true" />}
        action={
          <Button variant="primary" onClick={onStartClaude} disabled={!canStartClaude}>
            Start Claude
          </Button>
        }
      >
        Jobs you find and check will show up here. The job list arrives in an upcoming build.
        Meanwhile, you can start your Claude here and talk to it directly.
      </EmptyState>
    </main>
  );
}
