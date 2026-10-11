import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi, JobList } from '../../shared/api.ts';

export type JobsState =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; list: JobList };

/** The user's jobs, kept current as the app reads new work or saves an edit. */
export function useJobs(api: FactwrightApi) {
  const [jobs, setJobs] = useState<JobsState>({ state: 'loading' });
  const load = useCallback(() => {
    setJobs({ state: 'loading' });
    api.listJobs().then(
      (list) => setJobs({ state: 'ready', list }),
      () => setJobs({ state: 'failed' }),
    );
  }, [api]);
  useEffect(() => {
    load();
    return api.onJobsChanged((list) => setJobs({ state: 'ready', list }));
  }, [api, load]);
  return { jobs, reload: load };
}
