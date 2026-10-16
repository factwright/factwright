import { describe, expect, it } from 'vitest';
import { readJobPage } from '../src/page/read-job.ts';
import { fromTabTitle, jobAddress, jobFromTab, toSave } from '../src/tab-job.ts';

const ADDRESSES = [
  'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer',
  'https://www.linkedin.com/jobs/view/staff-engineer-at-northwind-4012345678/?trk=abc',
  'https://www.indeed.com/jobs?q=analyst&vjk=a1b2c3d4e5',
  'https://uk.indeed.com/viewjob?jk=abc123&from=serp',
  'https://jobs.example.com/pm-data?utm_source=x&team=data#apply',
  'not a link',
];

describe('a job’s own address', () => {
  it('is the same as reading the page gives', () => {
    for (const href of ADDRESSES) {
      const page = new DOMParser().parseFromString('<title>x</title>', 'text/html');
      expect(jobAddress(href), href).toBe(readJobPage(page, href, '').url);
    }
  });

  it('is the job’s own page on LinkedIn and Indeed, and the page without tracking elsewhere', () => {
    expect(jobAddress(ADDRESSES[0] ?? '')).toBe('https://www.linkedin.com/jobs/view/4012345678/');
    expect(jobAddress(ADDRESSES[2] ?? '')).toBe('https://www.indeed.com/viewjob?jk=a1b2c3d4e5');
    expect(jobAddress(ADDRESSES[4] ?? '')).toBe('https://jobs.example.com/pm-data?team=data');
  });
});

describe('a tab’s title', () => {
  it('names the job and company as job sites write them', () => {
    expect(fromTabTitle('(3) Staff Engineer, Payments | Northwind | LinkedIn')).toEqual({
      role: 'Staff Engineer, Payments',
      company: 'Northwind',
    });
    expect(fromTabTitle('Northwind hiring Staff Engineer in Austin, TX | LinkedIn')).toEqual({
      role: 'Staff Engineer',
      company: 'Northwind',
    });
    expect(fromTabTitle('Job Application for Data Lead at Fernway')).toEqual({
      role: 'Data Lead',
      company: 'Fernway',
    });
    expect(fromTabTitle('Senior Engineer - Platform - Acme')).toEqual({
      role: 'Senior Engineer',
      company: 'Acme',
    });
    expect(fromTabTitle('Careers')).toEqual({ role: 'Careers', company: '' });
  });
});

describe('the job to save', () => {
  it('takes the company from the site when the page names none', () => {
    const job = jobFromTab('https://careers.lumen.example/jobs/7', 'Clinical Data Lead');
    expect(toSave(job)).toEqual({
      url: 'https://careers.lumen.example/jobs/7',
      site: 'careers.lumen.example',
      company: 'Lumen',
      role: 'Clinical Data Lead',
      pay: '',
      posting: '',
    });
  });
});
