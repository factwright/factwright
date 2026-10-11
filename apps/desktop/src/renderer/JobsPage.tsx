import { EmptyState } from '@factwright/ui';
import { Briefcase } from 'lucide-react';
import styles from './JobsPage.module.css';

/** The jobs page. For now it holds the empty state until the job list is built. */
export function JobsPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Jobs</h1>
      <EmptyState title="No jobs yet" icon={<Briefcase size={20} aria-hidden="true" />}>
        Jobs you find and check will show up here. The job list arrives in an upcoming build.
      </EmptyState>
    </main>
  );
}
