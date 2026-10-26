import { describe, expect, it } from 'vitest';
import { sampleJobs } from './jobs/sample-jobs.ts';
import { runTitle } from './runTitle.ts';

const jobs = sampleJobs();
const acme = jobs.find((job) => job.company === 'Acme Robotics');

describe('a run’s name', () => {
  it('leads with its job’s company, then the task, as its button names it', () => {
    if (!acme) throw new Error('No sample job for Acme Robotics');
    expect(runTitle({ skill: 'analyze-job', jobId: acme.id }, jobs)).toBe(
      'Acme Robotics · Analyze job',
    );
    expect(runTitle({ skill: 'job-search' }, jobs)).toBe('Job search');
    expect(runTitle(null, jobs)).toBe('Claude');
  });

  it('says how many jobs a run analyzes, then how many it’s done', () => {
    const jobIds = ['a--1', 'b--2', 'c--3', 'd--4', 'e--5', 'f--6'];
    expect(runTitle({ skill: 'analyze-job', jobIds }, jobs)).toBe('Analyze · 6 jobs');
    expect(runTitle({ skill: 'analyze-job', jobIds: ['a--1'] }, jobs)).toBe('Analyze · 1 job');
    expect(runTitle({ skill: 'analyze-job', jobIds, auto: true }, jobs)).toBe(
      'Analyze · 6 new jobs',
    );
    expect(runTitle({ skill: 'analyze-job', jobIds }, jobs, ['b--2', 'a--1', 'gone--7'])).toBe(
      'Analyze · 2 of 6 done',
    );
  });
});
