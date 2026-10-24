// SmartRecruiters', SuccessFactors', iCIMS's and Taleo's applications, filled in Chromium beside the
// panel, as e2e-fill.ts fills Lever's and Workday's: each served on this computer, its pages built
// from the system's own markup with its own code acted out, for a made-up company. You go on from
// page to page, pressing each system's own buttons, and the panel offers to fill each page as it
// comes. Factwright never presses them, never submits, and leaves what's yours: your name where it
// signs, agreeing, a resume box that sends the form, and a list that posts its page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { icimsCode } from './icims-own-code.ts';
import { type ServedFlow, servedFlow } from './served-flow.ts';
import { withOwnCode } from './sites-own-code.ts';
import { smartRecruitersCode } from './smartrecruiters-own-code.ts';
import { successFactorsCode } from './successfactors-own-code.ts';
import { taleoCode } from './taleo-own-code.ts';

/** SmartRecruiters' form, at its own address, and where its next page comes from. */
const SR_PATH =
  '/oneclick-ui/company/SaltmarshRobotics/publication/5a1c0de4-2b8f-4e7a-9d31-0c6e2f8b7a15';
const SR_PAGES = '/smartrecruiters-pages/';
/** SuccessFactors' application, once you've signed in, at your session's address. */
const SF_PATH = '/portalcareer?_s.crb=sample';
/** iCIMS's portal for the job: the careers page around its frame, and each step's address. */
const ICIMS = '/jobs/4821/robotics-software-engineer/';
/** Taleo's steps, each posted to the same address. */
const TALEO_PATH = '/careersection/careersection/candidateacquisition/flow.jsf';

/** The systems' pages, and their applications whose pages load anew, as this computer serves them. */
export interface SystemsSite {
  pages: Record<string, Buffer>;
  flows: ServedFlow[];
  icims: ServedFlow;
  taleo: ServedFlow;
}

/**
 * iCIMS's portal for the job, a step at a time: the careers page around its frame, and in the
 * frame each step's page, at its own address, the next once its form is posted.
 */
function icimsFlow(fixtures: string): ServedFlow {
  const step = (name: string) =>
    withOwnCode(readFileSync(join(fixtures, `icims-${name}.html`), 'utf8'), icimsCode());
  const steps: Record<string, { page: string; next: string | null }> = {
    candidate: { page: step('candidate'), next: 'questions' },
    questions: { page: step('questions'), next: 'eeo' },
    eeo: { page: step('eeo'), next: null },
  };
  const wrapper = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<title>Robotics Software Engineer | Careers at Bramblecrest Robotics</title></head>',
    '<body style="margin:0;font-family:sans-serif">',
    '<header style="padding:0 24px"><h1>Careers at Bramblecrest Robotics</h1>',
    '<p><input type="email" placeholder="Enter your email address here" aria-label="Get our newsletter"></p></header>',
    '<span id="icims_iframe_span" role="main" aria-label="Career Portal">',
    `<iframe id="icims_content_iframe" name="icims_content_iframe" title="iCIMS Content iFrame" src="${ICIMS}candidate?in_iframe=1" style="display:block;width:100%;height:4400px;border:0"></iframe>`,
    '</span></body></html>',
  ].join('');
  const pressed = { next: 0, back: 0, submit: 0 };
  const send = (response: ServerResponse, html: string) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  };
  return {
    pressed,
    restart: () => {},
    async serve(request: IncomingMessage, response: ServerResponse) {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith(ICIMS)) return false;
      const name = url.pathname.slice(ICIMS.length);
      const at = steps[name];
      if (!at) return false;
      if (request.method === 'POST') {
        for await (const _ of request) {
          // The post's form, read through: what was sent doesn't matter here.
        }
        if (!at.next) {
          pressed.submit += 1;
          send(response, '<!doctype html><p>Your application was submitted successfully.</p>');
          return true;
        }
        pressed.next += 1;
        send(response, steps[at.next]?.page ?? '');
        return true;
      }
      send(response, url.searchParams.get('in_iframe') === '1' ? at.page : wrapper);
      return true;
    },
  };
}

/** The systems' pages, served on this computer, from the fixtures. */
export function systemsSite(fixtures: string): SystemsSite {
  const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8');
  const icims = icimsFlow(fixtures);
  const taleo = servedFlow(
    TALEO_PATH,
    ['personal', 'experience', 'questions', 'diversity', 'esignature'].map((step) =>
      withOwnCode(fixture(`taleo-${step}.html`), taleoCode()),
    ),
    {
      next: (form) => /saveContinueCmd(Bottom)?$/.test(form.get('jsfCmdId') ?? ''),
      submit: (form) => /submitCmd(Bottom)?$/.test(form.get('jsfCmdId') ?? ''),
    },
  );
  return {
    pages: {
      [SR_PATH]: Buffer.from(
        withOwnCode(fixture('smartrecruiters-application.html'), smartRecruitersCode(SR_PAGES)),
      ),
      [`${SR_PAGES}smartrecruiters-screening.html`]: Buffer.from(
        fixture('smartrecruiters-screening.html'),
      ),
      [SF_PATH]: Buffer.from(
        withOwnCode(fixture('successfactors-application.html'), successFactorsCode()),
      ),
    },
    flows: [icims, taleo],
    icims,
    taleo,
  };
}

/** The systems' jobs in the made-up job hunt, each with its application's address, as you'd save it. */
export function systemsJobs(workspace: string, origin: string): void {
  const jobs: [string, string, string, string][] = [
    [
      'saltmarsh-robotics-robotics-software-intern',
      'Saltmarsh Robotics',
      'Robotics Software Intern',
      `SmartRecruiters ${origin}${SR_PATH}`,
    ],
    [
      'copperline-utilities-field-data-analyst',
      'Copperline Utilities',
      'Field Data Analyst',
      `SuccessFactors ${origin}${SF_PATH}`,
    ],
    [
      'bramblecrest-robotics-robotics-software-engineer',
      'Bramblecrest Robotics',
      'Robotics Software Engineer',
      `iCIMS ${origin}${ICIMS}candidate?in_iframe=1`,
    ],
    [
      'bramblecote-logistics-fleet-data-analyst',
      'Bramblecote Logistics',
      'Fleet Data Analyst',
      `Taleo ${origin}${TALEO_PATH}`,
    ],
  ];
  for (const [slug, company, role, link] of jobs) {
    const folder = join(workspace, 'applications', `2026-10-24-${slug}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'job.md'),
      [
        `# ${company}: ${role}`,
        '',
        '- **Date:** 2026-10-24',
        '- **Work arrangement:** On-site, Denver, CO',
        `- **Links:** ${link}`,
      ].join('\n'),
    );
  }
}

/** What a run of the systems' applications needs from the run it's part of. */
export interface SystemsRun {
  context: BrowserContext;
  origin: string;
  site: SystemsSite;
  /** The browser's tab a page is in, as the panel is told it. */
  tabOf: (page: Page) => Promise<{ id: number; windowId: number; url: string; title: string }>;
  panelOn: (tab: { id: number; windowId: number; url: string; title: string }) => Promise<Page>;
  check: (that: boolean, what: string) => void;
  /** Your phone in Profile now, as the run before this changed it. */
  phone: () => string;
  errors: string[];
  shoot: (page: Page, name: string) => Promise<void>;
}

/** Waits until the panel says the page it filled is filled. */
const filledIn = (panel: Page) =>
  panel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 40_000 });

/** Waits for the panel's offer to fill the page an application went on to, and takes it. */
async function fillNext(panel: Page, step: string) {
  await panel
    .getByText(`The application is on ${step} now`, { exact: false })
    .waitFor({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Fill this page', exact: true }).click();
  await filledIn(panel);
}

/** Goes through each system's application, as you would, with the panel beside it. */
export async function fillSystems(run: SystemsRun): Promise<void> {
  const { context, origin, check, errors } = run;
  /** Checks a page shows what's wanted, and says what it showed if it doesn't. */
  const sees = (what: string, seen: Record<string, unknown>, wanted: Record<string, unknown>) => {
    const same = JSON.stringify(seen) === JSON.stringify(wanted);
    check(same, same ? what : `${what}: it showed ${JSON.stringify(seen)}`);
  };
  const open = async (path: string) => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}${path}`);
    await page.bringToFront();
    return page;
  };

  // SmartRecruiters' newer form: its components keep their insides in shadow roots, and Next
  // brings its screening questions in, in the same tab.
  const sr = await open(SR_PATH);
  const srPanel = await run.panelOn(await run.tabOf(sr));
  await filledIn(srPanel);
  const srModel = () =>
    sr.evaluate(() => (globalThis as unknown as { srModel: Record<string, unknown> }).srModel);
  const first = await srModel();
  sees(
    'SmartRecruiters: it fills the boxes inside its components, and picks the place its list offers',
    {
      job: await srPanel.getByText('Robotics Software Intern at Saltmarsh Robotics').count(),
      first: first.firstName,
      last: first.lastName,
      email: first.email,
      city: (first['location-autocomplete'] as { text?: string } | undefined)?.text,
    },
    { job: 1, first: 'Ana María', last: 'Ruiz', email: 'ana@example.com', city: 'Denver, CO, US' },
  );
  await srPanel.getByRole('button', { name: 'Add 3 for your other jobs', exact: true }).click();
  await filledIn(srPanel);
  const titles = await sr
    .locator('oc-experience-entry [data-test="job-title-autocomplete"] input')
    .evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).value));
  sees(
    'Add for your other jobs presses its Add, and fills each part it opens with the next job',
    { titles },
    { titles: ['Director of Product', 'Senior Product Manager', 'Product Manager'] },
  );
  await run.shoot(sr, 'fill-12-smartrecruiters');
  await sr.locator('oc-button[data-test="footer-next"] button').click();
  await fillNext(srPanel, 'Preliminary questions');
  const screening = await srModel();
  const srPressed = await sr.evaluate(() => {
    const page = globalThis as unknown as { srNexts: number; srSubmits: number };
    return { nexts: page.srNexts, submits: page.srSubmits };
  });
  sees(
    'its screening questions’ own radio buttons, from Profile; only you pressed Next, and nothing Submit',
    {
      authorized: screening.question_authorized,
      sponsorship: screening.question_sponsorship,
      ...srPressed,
    },
    { authorized: '1', sponsorship: '0', nexts: 1, submits: 0 },
  );
  await srPanel.close();
  await sr.close();

  // SuccessFactors' application: one long page, filled in from your stored profile already.
  const sf = await open(SF_PATH);
  const sfPanel = await run.panelOn(await run.tabOf(sf));
  await filledIn(sfPanel);
  const boxed = (id: string) => sf.locator(`[id="${id}"]`).inputValue();
  const radioPicked = (group: string) =>
    sf
      .locator(`[id="${group}"] [role="radio"][aria-checked="true"]`)
      .evaluateAll((radios) => radios[0]?.parentElement?.textContent?.trim() ?? '');
  sees(
    'SuccessFactors: it keeps what your profile filled in, and fills the rest, picking from its lists',
    {
      job: await sfPanel.getByText('Field Data Analyst at Copperline Utilities').count(),
      first: await boxed('60:_txtFld'),
      phone: await boxed('76:_txtFld'),
      state: await boxed('95:_input'),
      heard: await boxed('188:_input'),
    },
    // Found on the company's own site, as the job was saved from there.
    { job: 1, first: 'Ana', phone: run.phone(), state: 'Colorado', heard: 'Company Website' },
  );
  sees(
    'its own radio buttons, the job its profile listed, and never the signature, which is yours',
    {
      work: await radioPicked('174:'),
      sponsorship: await radioPicked('194:'),
      gender: await radioPicked('305:'),
      title: await boxed('126:_txtFld'),
      signature: await boxed('331:_txtFld'),
    },
    {
      work: 'Yes',
      sponsorship: 'No',
      gender: 'Female',
      title: 'Director of Product',
      signature: '',
    },
  );
  await sfPanel.getByRole('button', { name: 'Add 2 for your other jobs', exact: true }).click();
  await filledIn(sfPanel);
  const companies = await sf
    .locator('[id="118:_bgElementContainer"] input[name="VFLD1"]')
    .evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).value));
  sees(
    'Add for your other jobs adds a row for each, and fills it',
    { companies },
    { companies: ['Tidewater Analytics', 'Tidewater Analytics', 'Fernway'] },
  );
  const sfSent = await sf.evaluate(() => {
    const page = globalThis as unknown as Record<string, number>;
    return [page.sfSubmits, page.sfApplies, page.sfSaves];
  });
  sees('and never sends the form, applies or saves', { sfSent }, { sfSent: [0, 0, 0] });
  await run.shoot(sf, 'fill-13-successfactors');
  await sfPanel.close();
  await sf.close();

  // iCIMS: its portal in a frame on the careers page, a page a step, each loaded anew.
  const icims = await open(`${ICIMS}candidate`);
  const icimsPanel = await run.panelOn(await run.tabOf(icims));
  await filledIn(icimsPanel);
  const frame = icims.frame({ name: 'icims_content_iframe' });
  if (!frame) throw new Error('No iCIMS frame.');
  const inFrame = (id: string) => frame.locator(`[id="${id}"]`).inputValue();
  const shows = (id: string) =>
    frame.locator(`[id="${id}_icimsDropdown"]`).evaluate((link) => link.textContent?.trim() ?? '');
  sees(
    'iCIMS: it fills the form in its frame, its own dropdowns searched past their first page',
    {
      job: await icimsPanel
        .getByText('Robotics Software Engineer at Bramblecrest Robotics')
        .count(),
      first: await inFrame('PersonProfileFields.FirstName'),
      street: await inFrame('-1_PersonProfileFields.AddressStreet1'),
      country: await shows('-1_PersonProfileFields.AddressCountry'),
      state: await shows('-1_PersonProfileFields.AddressState'),
      authorized: await shows('rcf2504'),
    },
    {
      job: 1,
      first: 'Ana María',
      street: '1420 Larimer St',
      country: 'United States',
      state: 'Colorado',
      authorized: 'Yes',
    },
  );
  const posted = await frame.evaluate(() => {
    const page = globalThis as unknown as Record<string, number>;
    return page.icimsResumePosts;
  });
  sees(
    'and never its resume box, which sends the form, nor its login',
    { posted, login: await inFrame('PersonProfileFields.Login') },
    { posted: 0, login: '' },
  );
  await icimsPanel.getByRole('button', { name: 'Add 2 for your other jobs', exact: true }).click();
  await filledIn(icimsPanel);
  sees(
    'Add More for your other jobs, a block each, filled',
    { third: await inFrame('-3_PersonProfileFields.rcf3212') },
    { third: 'Fernway' },
  );
  await run.shoot(icims, 'fill-14-icims');
  await frame.locator('#cp_form_submit_i').click();
  await fillNext(icimsPanel, 'Candidate Questions');
  sees(
    'Submit Profile, pressed as you would, loads its questions, which the panel fills',
    {
      eligible: await frame.locator('#Q2414').inputValue(),
      sponsorship: await frame.locator('#Q2415').inputValue(),
    },
    { eligible: 'Yes', sponsorship: 'No' },
  );
  await frame.locator('#quesp_form_submit_i').click();
  await fillNext(icimsPanel, 'EEO');
  sees(
    'and its EEO page, your answer from Profile; only you went on, and nothing was submitted',
    {
      gender: await frame.locator('[id="CandProfileFields.Gender"]').inputValue(),
      ...run.site.icims.pressed,
    },
    { gender: 'Female', next: 2, back: 0, submit: 0 },
  );
  await icimsPanel.close();
  await icims.close();

  // Taleo: each step posted to the same address, its lists filled from its server once the one
  // before is picked.
  const taleo = await open(TALEO_PATH);
  const taleoPanel = await run.panelOn(await run.tabOf(taleo));
  await filledIn(taleoPanel);
  const taleoField = (end: string) => taleo.locator(`[id$="${end}"]`).first().inputValue();
  const taleoShows = (end: string) =>
    taleo
      .locator(`[id$="${end}"]`)
      .first()
      .evaluate((select) => (select as HTMLSelectElement).selectedOptions[0]?.text ?? '');
  sees(
    'Taleo: it fills a step, and a place a level at a time, as each list fills from its server',
    {
      job: await taleoPanel.getByText('Fleet Data Analyst at Bramblecote Logistics').count(),
      first: await taleoField('FirstName'),
      country: await taleoShows('ResidenceLocation-0'),
      state: await taleoShows('ResidenceLocation-1'),
      city: await taleoShows('ResidenceLocation-2'),
    },
    { job: 1, first: 'Ana María', country: 'United States', state: 'Colorado', city: 'Denver' },
  );
  const next = () => taleo.locator('[id="et-ef-content-ftf-saveContinueCmdBottom"]').click();
  await next();
  await fillNext(taleoPanel, 'Work Experience');
  sees(
    'Save and Continue, pressed as you would, loads Work Experience, its month and year lists filled',
    {
      employer: await taleoField('dv_cs_experience_Employer'),
      month: await taleoShows('dv_cs_experience_BeginDate.month'),
      year: await taleoShows('dv_cs_experience_BeginDate.year'),
      school: await taleoField('dv_cs_education_Institution'),
    },
    { employer: 'Tidewater Analytics', month: 'April', year: '2023', school: 'CU Boulder' },
  );
  await next();
  await fillNext(taleoPanel, 'Job Specific Questions');
  await next();
  await fillNext(taleoPanel, 'Diversity - Part 1');
  await next();
  await fillNext(taleoPanel, 'eSignature');
  sees(
    'its eSignature is yours to sign; only you pressed Save and Continue, and nothing was submitted',
    { name: await taleoField('dv_cs_esignature_FullName'), ...run.site.taleo.pressed },
    { name: '', next: 4, back: 0, submit: 0 },
  );
  await run.shoot(taleo, 'fill-15-taleo');
  await taleoPanel.close();
  await taleo.close();
}
