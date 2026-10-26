import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type PageJob, readJobPage } from '../src/page/read-job.ts';
import { companyFromAddress, looksLikeJob, needsChecking, toSave } from '../src/tab-job.ts';

// The fixtures are job sites' pages as Chromium and Firefox showed them on 2026-10-16, when the
// built extension read real ones: the same elements, classes and attributes, with the words made
// up. A site that changes its layout again gets a fixture of the new one beside its old one. Read
// by their path: jsdom's URL, in these tests, would take a file's address as one on its own page.
const FIXTURES = join(import.meta.dirname, 'fixtures');

const html = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
/** A fixture, as the browser would have it. */
const fixture = (name: string) => new DOMParser().parseFromString(html(name), 'text/html');
/** What a save without the popup makes of what was read: null when it saves it as it is. */
const quickSave = (job: PageJob) => needsChecking(job, toSave(job), null);

describe('Indeed', () => {
  it('reads a job’s own page in its current layout', () => {
    const job = readJobPage(
      fixture('indeed-viewjob.html'),
      'https://www.indeed.com/viewjob?jk=a1b2c3d4e5&from=serp',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://www.indeed.com/viewjob?jk=a1b2c3d4e5',
      title: 'Data Analyst',
      company: 'Fernway',
      location: 'Austin, TX',
      source: 'page',
    });
    expect(job.posting).toBe(
      'About the role:\n\nFernway is hiring a data analyst to turn our shipping data into decisions.\n\n- Write SQL against our warehouse\n- Build dashboards for the operations team\n\nPay: $70,000 - $85,000 a year',
    );
    expect(quickSave(job)).toBeNull();
  });

  it('reads the job a search shows beside its results, as the job’s own page', () => {
    const job = readJobPage(
      fixture('indeed-search.html'),
      'https://www.indeed.com/jobs?q=data+analyst&l=Austin%2C+TX&vjk=a1b2c3d4e5',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://www.indeed.com/viewjob?jk=a1b2c3d4e5',
      title: 'Data Analyst',
      company: 'Fernway',
      location: 'Austin, TX',
      source: 'page',
    });
    expect(job.posting).toBe(
      'Fernway is hiring a data analyst to turn our shipping data into decisions.\n\n- Write SQL against our warehouse\n- Build dashboards for the operations team',
    );
    expect(quickSave(job)).toBeNull();
  });
});

describe('LinkedIn, signed out', () => {
  it('reads the job its public search shows beside its results', () => {
    const job = readJobPage(
      fixture('linkedin-public-search.html'),
      'https://www.linkedin.com/jobs/search?keywords=Software%20Engineer&currentJobId=4012345678&position=1&pageNum=0',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      title: 'Software Engineer, Payments',
      company: 'Northwind',
      location: 'Austin, TX',
      source: 'page',
    });
    expect(job.posting).toBe(
      'Northwind moves money for small shops.\n\nWhat you’ll do\n\n- Build our payments API\n- Keep it up',
    );
    expect(quickSave(job)).toBeNull();
  });
});

describe('Hacker News', () => {
  const thread = 'https://news.ycombinator.com/item?id=41000001';
  const post = (doc: Document, id: string) =>
    doc.querySelector(`[id="${id}"] .commtext`) as Element;

  it('reads a “Who is hiring?” post on its own page: its first line names the company and title', () => {
    const job = readJobPage(
      fixture('hacker-news-post.html'),
      'https://news.ycombinator.com/item?id=41000002',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://news.ycombinator.com/item?id=41000002',
      site: 'news.ycombinator.com',
      title: 'Senior Data Engineer',
      company: 'Fernway',
      source: 'page',
    });
    expect(job.posting).toMatch(/^Fernway \| Senior Data Engineer \| Austin, TX/);
    expect(job.posting).toContain('Apply: https://fernway.example/jobs/data');
    // Not Hacker News's own links, its form, or the replies.
    for (const text of ['Hacker News', 'add comment', 'Canada', 'Guidelines']) {
      expect(job.posting).not.toContain(text);
    }
    expect(quickSave(job)).toBeNull();
  });

  it('reads the post the selected text is in, with the post’s own address, from a whole thread', () => {
    const doc = fixture('hacker-news-thread.html');
    // A few words of a post: the post is read.
    const words = readJobPage(doc, thread, 'homework tools', '', post(doc, '41000004').lastChild);
    expect(words).toMatchObject<Partial<PageJob>>({
      url: 'https://news.ycombinator.com/item?id=41000004',
      title: 'Full-Stack Software Engineer',
      company: 'Larkspur Learning',
      source: 'page',
    });
    expect(words.posting).toBe(
      'Larkspur Learning (Remote US) — Full-Stack Software Engineer — TypeScript / Postgres / React\nWe make homework tools that teachers actually like.',
    );
    // All of a post: what's selected is the posting.
    const selected = post(doc, '41000002').textContent ?? '';
    const all = readJobPage(doc, thread, selected, '', post(doc, '41000002').firstChild);
    expect(all).toMatchObject<Partial<PageJob>>({
      url: 'https://news.ycombinator.com/item?id=41000002',
      title: 'Senior Data Engineer',
      company: 'Fernway',
      posting: selected.trim(),
      source: 'selection',
    });
    expect(quickSave(all)).toBeNull();
  });

  it('takes the post from the page’s own selection, as a click reads it', () => {
    document.documentElement.innerHTML =
      fixture('hacker-news-thread.html').documentElement.innerHTML;
    const select = (from: Node, to: Node) => {
      const range = document.createRange();
      range.setStart(from, 0);
      range.setEnd(to, to.childNodes.length);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    };
    select(post(document, '41000002'), post(document, '41000002'));
    expect(readJobPage(document, thread)).toMatchObject<Partial<PageJob>>({
      url: 'https://news.ycombinator.com/item?id=41000002',
      company: 'Fernway',
      source: 'selection',
    });
    // Text across two posts is neither's.
    select(post(document, '41000002'), post(document, '41000004'));
    expect(readJobPage(document, thread)).toMatchObject<Partial<PageJob>>({
      url: thread,
      company: '',
      source: 'selection',
    });
    getSelection()?.removeAllRanges();
  });

  it('leaves a post’s title for the popup when its first line names no role', () => {
    const doc = fixture('hacker-news-thread.html');
    const job = readJobPage(doc, thread, '', '', post(doc, '41000005').firstChild);
    expect(job).toMatchObject<Partial<PageJob>>({ company: 'Quill Robotics', title: '' });
    expect(quickSave(job)).toMatch(/title/);
  });

  it('reads a thread with no post selected as a page, and takes no company from its address', () => {
    const job = readJobPage(fixture('hacker-news-thread.html'), thread, '', '', null);
    expect(job).toMatchObject<Partial<PageJob>>({ url: thread, company: '', source: 'main' });
    expect(companyFromAddress(job.url)).toBe('');
    expect(quickSave(job)).not.toBeNull();
  });
});

describe('Greenhouse', () => {
  it('reads a job board’s company from the tab’s title, not its address', () => {
    const job = readJobPage(
      fixture('greenhouse-job.html'),
      'https://job-boards.greenhouse.io/harborpineoutfitters/jobs/4461450008?gh_src=abc',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://job-boards.greenhouse.io/harborpineoutfitters/jobs/4461450008',
      title: 'Account Executive, Mid-Market',
      company: 'Harbor & Pine Outfitters',
      location: 'Portland, OR | Remote (US)',
      source: 'page',
    });
    expect(job.posting).toBe(
      'About Harbor & Pine\n\nWe make outdoor gear that lasts, and we sell it to the shops that care.\n\nWhat you’ll do\n\n- Grow our accounts with mid-sized retailers\n- Work with our buyers on each season’s orders',
    );
    expect(companyFromAddress(job.url)).toBe('Harborpineoutfitters');
  });
});

describe('Workday', () => {
  const job =
    'en-US/NorthwindCareers/job/US-TX-Austin/Senior-Systems-Engineer----Platform_JR2025315';
  /** The company read from the fixture, with another legal entity hiring, at another site. */
  const hiring = (entity: string, host = 'northwind.wd5.myworkdayjobs.com') =>
    readJobPage(
      new DOMParser().parseFromString(
        html('workday-job.html').replace('2100 Northwind USA', entity),
        'text/html',
      ),
      `https://${host}/${job}`,
      '',
    ).company;

  it('takes the company from the legal entity its job data names, without the entity’s code', () => {
    expect(
      readJobPage(
        fixture('workday-job.html'),
        `https://northwind.wd5.myworkdayjobs.com/${job}`,
        '',
      ),
    ).toMatchObject<Partial<PageJob>>({
      title: 'Senior Systems Engineer -- Platform',
      company: 'Northwind',
      location: 'US, TX, Austin, United States of America',
      posted: '2026-10-16',
      source: 'structured',
    });
    // The site's own name, as the entity writes it, with a capital.
    expect(hiring('ADUS-Northwind Inc.')).toBe('Northwind');
    expect(hiring('500 NORTHWIND Ireland Ltd.')).toBe('NORTHWIND');
    expect(hiring('110 northwind.com Canada Corporation')).toBe('Northwind');
    // An entity without it, without its code.
    expect(hiring('IN01 Tidewater Graphics Bengaluru')).toBe('Tidewater Graphics Bengaluru');
    expect(hiring('US: Tidewater International Inc.')).toBe('Tidewater International Inc.');
    expect(hiring('Ireland: Tidewater Ireland Limited')).toBe('Tidewater Ireland Limited');
    expect(hiring('Tidewater Analytics')).toBe('Tidewater Analytics');
  });

  it('leaves a company’s name as it is anywhere else', () => {
    expect(hiring('2100 Northwind USA', 'careers.northwind.example')).toBe('2100 Northwind USA');
  });
});

describe('SmartRecruiters', () => {
  it('reads the posting without the map, buttons and links after it', () => {
    const job = readJobPage(
      fixture('smartrecruiters-job.html'),
      'https://jobs.smartrecruiters.com/FernwayGroup/744000155993379-software-engineer-ai',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      title: 'Software Engineer - AI (f/m/div.)',
      company: 'Fernway Group',
      source: 'page',
    });
    expect(job.posting).toBe(
      'Company Description\n\nFernway Group builds tools for engineers in 40 countries.\n\nJob Description\n\n- Build the models behind our search.\n\nQualifications\n\nThree years of Python.',
    );
  });
});

describe('every job site’s page here', () => {
  it('looks like a job’s, so the popup fills in what it read', () => {
    for (const [name, href] of [
      ['indeed-viewjob.html', 'https://www.indeed.com/viewjob?jk=a1b2c3d4e5&from=serp'],
      ['indeed-search.html', 'https://www.indeed.com/jobs?q=data+analyst&vjk=a1b2c3d4e5'],
      [
        'linkedin-public-search.html',
        'https://www.linkedin.com/jobs/search?keywords=Software%20Engineer&currentJobId=4012345678',
      ],
      ['hacker-news-post.html', 'https://news.ycombinator.com/item?id=41000002'],
      // A whole thread, read as a page, which the popup leaves for you to pick a post from.
      ['hacker-news-thread.html', 'https://news.ycombinator.com/item?id=41000001'],
      [
        'greenhouse-job.html',
        'https://job-boards.greenhouse.io/harborpineoutfitters/jobs/4461450008',
      ],
      [
        'workday-job.html',
        'https://northwind.wd5.myworkdayjobs.com/en-US/NorthwindCareers/job/US-TX-Austin/Senior-Systems-Engineer----Platform_JR2025315',
      ],
      [
        'smartrecruiters-job.html',
        'https://jobs.smartrecruiters.com/FernwayGroup/744000155993379-software-engineer-ai',
      ],
    ] as const) {
      expect(looksLikeJob(readJobPage(fixture(name), href, ''), null), name).toBe(true);
    }
  });
});

describe('Lever', () => {
  const LEVER = 'https://jobs.lever.co/harborpine/4f1c2b7e-6a1d-4f0e-9c2b-7d3e5a8b1c90';

  it('reads the pay its salary section shows, as its job data has none', () => {
    const job = readJobPage(fixture('lever-job.html'), `${LEVER}?lever-source=LinkedIn`, '');
    expect(job).toMatchObject<Partial<PageJob>>({
      url: LEVER,
      title: 'Senior Product Manager, Data',
      company: 'Harbor & Pine',
      location: 'Denver, CO',
      pay: '$161,000 - $245,000 a year',
      employment: 'Full-time',
      posted: '2026-10-06',
      source: 'structured',
    });
    expect(toSave(job).pay).toBe('$161,000 - $245,000 a year');
    expect(quickSave(job)).toBeNull();
  });

  it('takes the pay from the posting’s words where it has no salary section', () => {
    const page = fixture('lever-job.html');
    page.querySelector('[data-qa="salary-range"]')?.remove();
    const job = readJobPage(page, LEVER, '');
    expect(job.pay).toBe('');
    const posting = `${job.posting}\n\n$161,000 - $245,000 a year`;
    expect(toSave({ ...job, posting }).pay).toBe('$161,000–$245,000 a year');
  });
});

describe('iCIMS', () => {
  const FRAME =
    'https://careers-larkspurhealth.icims.com/jobs/8341/staff-software-engineer/job?in_iframe=1';

  it('reads its frame’s posting from the frame’s own job data, and the pay from the posting', () => {
    const job = readJobPage(fixture('icims-posting.html'), FRAME, '');
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://careers-larkspurhealth.icims.com/jobs/8341/staff-software-engineer/job',
      title: 'Staff Software Engineer',
      company: 'Larkspur Health',
      location: 'Remote, US',
      employment: 'Full time',
      posted: '2026-10-09',
      source: 'structured',
    });
    expect(job.posting).toContain('Salary Range\n\n$144000.00 To $237500.00 / year');
    expect(toSave(job).pay).toBe('$144,000–$237,500 a year');
  });

  it('reads its frame’s posting by its layout, where it has no job data', () => {
    const page = fixture('icims-posting.html');
    page.querySelector('script[type="application/ld+json"]')?.remove();
    const job = readJobPage(page, FRAME, '');
    expect(job).toMatchObject<Partial<PageJob>>({
      title: 'Staff Software Engineer',
      // The portal's name, never its "careers".
      company: 'Larkspurhealth',
      location: 'US-Remote',
      source: 'page',
    });
    expect(job.posting).toContain('Larkspur Health is rebuilding how its members sign in');
    expect(toSave(job).pay).toBe('$144,000–$237,500 a year');
  });

  it('finds only the company’s branding on the page around the frame, which reading it fixes', () => {
    const job = readJobPage(
      fixture('icims-wrapper.html'),
      'https://careers-larkspurhealth.icims.com/jobs/8341/staff-software-engineer/job',
      '',
    );
    expect(job).toMatchObject({ title: 'Larkspur Health blog', location: '', pay: '' });
  });
});
