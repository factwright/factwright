import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchDeps } from './posting.ts';
import { readForAdding } from './posting.ts';
import { testPages } from './test-pages.ts';

/**
 * Real postings, saved as the app fetched them on 2026-11-04 (test/pages, listed by address in
 * its pages.json), which the tests read in the sites' place, so no test reaches a live site.
 */
const PAGES = join(import.meta.dirname, '../../../test/pages/pages.json');

/** Reads a link as Add job does, from the saved pages or the fetch given, with each address it asked for. */
async function adding(link: string, fetch: NonNullable<FetchDeps['fetch']> = testPages(PAGES)) {
  const asked: string[] = [];
  const read = await readForAdding(link, {
    fetch: (url, json, limitMs, maxBytes) => {
      asked.push(url);
      return fetch(url, json, limitMs, maxBytes);
    },
  });
  return { read, asked };
}

/** A fetch that fails as Node.js does when it can't connect, with the error's code. */
const failing =
  (code: string, message: string): NonNullable<FetchDeps['fetch']> =>
  async () => {
    throw Object.assign(new Error(message), { code });
  };

describe('reading a job’s link for Add job', () => {
  it('reads a posting on an applicant system from its feed, with its title and employer', async () => {
    const greenhouse = await adding('https://job-boards.greenhouse.io/gitlab/jobs/8638232002');
    expect(greenhouse.asked).toEqual([
      'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8638232002',
    ]);
    expect(greenhouse.read).toMatchObject({
      ok: true,
      posting: {
        via: 'Greenhouse API',
        title: 'AI Transformation Owner, CRO',
        company: 'GitLab',
      },
    });
    const lever = await adding(
      'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b',
    );
    expect(lever.read).toMatchObject({
      ok: true,
      posting: { via: 'Lever API', title: 'Account Executive - Commercial, Spotify Technology' },
    });
  });

  it('reads a big employer’s posting on Ashby from its own page, as the whole board is too big to read', async () => {
    const link = 'https://jobs.ashbyhq.com/openai/240d459b-696d-43eb-8497-fab3e56ecd9b';
    const { read, asked } = await adding(link);
    expect(asked).toEqual([
      'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true',
      link,
    ]);
    expect(read).toMatchObject({
      ok: true,
      posting: { via: 'the page’s JobPosting data', title: 'Research Engineer', company: 'OpenAI' },
    });
    expect(read.ok && read.posting.text).toContain('Pay: 250000–445000 USD YEAR');
  });

  it('reads Workday’s, iCIMS’s and SmartRecruiters’ pages, and a company’s own', async () => {
    const workday = await adding(
      'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Product-Manager--AI-Platform-SW---Agentic-AI-Kernel-Generation_JR2016992',
    );
    // The employer as the site names it, not Workday's legal entity, "2100 NVIDIA USA".
    expect(workday.read).toMatchObject({
      ok: true,
      posting: {
        via: 'the page’s JobPosting data',
        title: 'Product Manager, AI Platform SW - Agentic AI Kernel Generation',
        company: 'NVIDIA',
      },
    });
    // iCIMS's page is a frame that loads the posting later: its own view has it all.
    const icims = await adding(
      'https://careers-aptiveresources.icims.com/jobs/4751/payroll-and-benefits-administrator/job',
    );
    expect(icims.asked).toEqual([
      'https://careers-aptiveresources.icims.com/jobs/4751/payroll-and-benefits-administrator/job?in_iframe=1',
    ]);
    expect(icims.read).toMatchObject({
      ok: true,
      posting: { title: 'Payroll and Benefits Administrator', company: 'Aptive' },
    });
    const smartRecruiters = await adding(
      'https://jobs.smartrecruiters.com/AECOM2/744000156427409-senior-project-manager-data-centers-remote-u-s-',
    );
    expect(smartRecruiters.read).toMatchObject({ ok: true, posting: { via: 'the web page' } });
    expect(smartRecruiters.read.ok && smartRecruiters.read.posting.text).toContain(
      'Senior Project Manager',
    );
    const amazon = await adding(
      'https://www.amazon.jobs/en/jobs/10577480/program-manager-ii-amz26173-4',
    );
    expect(amazon.read.ok && amazon.read.posting.text).toContain('Program Manager II');
  });

  it('reads a Taleo posting from the page’s own data, not the site’s menus around it', async () => {
    const { read } = await adding(
      'https://uhg.taleo.net/careersection/10000/jobdetail.ftl?job=2380443&lang=en',
    );
    expect(read).toMatchObject({
      ok: true,
      posting: { via: 'Taleo', title: 'Lead Software Engineer' },
    });
    const text = read.ok ? read.posting.text : '';
    expect(text.startsWith('Lead Software Engineer\n\nOptum is a global organization')).toBe(true);
    expect(text).not.toContain('Hiring Process & Guidance');
    // Each block of the posting is there twice in the page's data, and once in what's read.
    expect(text.split('Optum is a global organization').length).toBe(2);
  });

  it('says a posting has closed: Workday’s page says so, Greenhouse has no such posting, or the page is gone', async () => {
    const workday = await adding(
      'https://clark.wd503.myworkdayjobs.com/clarkexternal/job/McLean-VA/Project-Manager_R5025094',
    );
    expect(workday.read).toEqual({
      ok: false,
      why: 'closed',
      message: 'Workday says this posting has closed.',
    });
    // Greenhouse sends a closed posting's page on to the company's other jobs, which are never
    // read as if they were the posting.
    const greenhouse = await adding('https://job-boards.greenhouse.io/omadahealth/jobs/7964775');
    expect(greenhouse.read).toEqual({
      ok: false,
      why: 'closed',
      message: 'Greenhouse says this posting has closed.',
    });
    expect(greenhouse.asked).toEqual([
      'https://boards-api.greenhouse.io/v1/boards/omadahealth/jobs/7964775',
    ]);
    const icims = await adding(
      'https://careers-aptiveresources.icims.com/jobs/4605/project-manager/job',
    );
    expect(icims.read).toEqual({
      ok: false,
      why: 'gone',
      message:
        'careers-aptiveresources.icims.com says that page isn’t there (410), so the posting has probably closed. Check the link, too.',
    });
  });

  it('says when a page shows its posting only in a browser', async () => {
    for (const link of [
      'https://jobs.apple.com/en-us/details/200626630-0836/engineering-project-manager-app-analytics',
      'https://jobs.dayforcehcm.com/en-US/signanthealth/CANDIDATEPORTAL/jobs/11768',
    ]) {
      const site = new URL(link).hostname;
      expect((await adding(link)).read).toEqual({
        ok: false,
        why: 'browser',
        message: `${site} shows the posting only in a web browser, or once you’re signed in, so Factwright found nothing to read.`,
      });
    }
  });

  it('never reads LinkedIn or Indeed, and never asks them for anything', async () => {
    const linkedIn = await adding('https://www.linkedin.com/jobs/view/4012345678/');
    expect(linkedIn).toEqual({
      read: {
        ok: false,
        why: 'linkedin',
        message: 'LinkedIn doesn’t let apps read its pages, so Factwright never does.',
      },
      asked: [],
    });
    const indeed = await adding('https://www.indeed.com/viewjob?jk=5596e5e51f871159');
    expect(indeed).toEqual({
      read: {
        ok: false,
        why: 'barred',
        message: 'Indeed turns apps away, so Factwright doesn’t read it.',
      },
      asked: [],
    });
  });

  it('says plainly when a site turns it away or can’t be reached, asking it once', async () => {
    const blocked = await adding('https://careers.blocks-apps.example/jobs/1');
    expect(blocked).toEqual({
      read: {
        ok: false,
        why: 'blocked',
        message:
          'careers.blocks-apps.example turned Factwright away (403): it blocks apps, or wants you signed in.',
      },
      asked: ['https://careers.blocks-apps.example/jobs/1'],
    });
    const link = 'https://careers.acme.example/jobs/1';
    expect(
      (await adding(link, failing('ENOTFOUND', 'getaddrinfo ENOTFOUND careers.acme.example'))).read,
    ).toEqual({
      ok: false,
      why: 'unreachable',
      message: 'Couldn’t find careers.acme.example. Check the link, and that you’re online.',
    });
    // Antivirus or a work network that checks secure connections can put its own certificate in
    // the way, which Node.js's own list of them doesn't know.
    expect(
      (
        await adding(
          link,
          failing('UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'unable to get local issuer certificate'),
        )
      ).read,
    ).toEqual({
      ok: false,
      why: 'unreachable',
      message:
        'Couldn’t connect safely to careers.acme.example (UNABLE_TO_GET_ISSUER_CERT_LOCALLY). Antivirus or a work network that checks secure connections can cause this.',
    });
    expect(
      (await adding(link, failing('ETIMEDOUT', 'the site took too long to answer'))).read,
    ).toEqual({
      ok: false,
      why: 'unreachable',
      message: 'Couldn’t reach careers.acme.example: the site took too long to answer.',
    });
  });

  it('turns away what isn’t an https link, before anything is asked', async () => {
    expect(await adding('http://careers.acme.example/jobs/1')).toEqual({
      read: { ok: false, why: 'refused', message: 'Only https links work.' },
      asked: [],
    });
    expect((await adding('careers at acme')).read).toEqual({
      ok: false,
      why: 'refused',
      message: 'That isn’t a link: links start with https://.',
    });
  });
});
