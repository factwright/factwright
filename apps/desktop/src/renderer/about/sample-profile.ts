import { TEMPLATES } from '@factwright/engine/templates';
import { type AboutYou, applyChanges, readAnswers, type SharedFile } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { Profile, ProfileStatus, TemplateInfo } from '../../shared/profile.ts';
import { samplePdf } from '../jobs/sample-pdf.ts';

type ProfileApi = Pick<
  FactwrightApi,
  | 'profile'
  | 'saveAnswers'
  | 'saveNotes'
  | 'changeConfidential'
  | 'addFile'
  | 'addLinkedIn'
  | 'removeFile'
  | 'startProfile'
  | 'useAnswersForCriteria'
  | 'templatePreview'
  | 'addTemplate'
  | 'removeTemplate'
  | 'onProfileChanged'
  | 'openTerminal'
>;

const FILES: SharedFile[] = [
  {
    path: 'about-me/files/2026-10-12-alex-rivera-resume.pdf',
    name: 'Alex Rivera resume.pdf',
    kind: 'resume',
    added: '2026-10-12',
    textFile: 'about-me/files/2026-10-12-alex-rivera-resume.pdf.md',
  },
  {
    path: 'about-me/files/linkedin-data.md',
    name: 'LinkedIn data',
    kind: 'linkedin-data',
    added: '2026-10-12',
    textFile: null,
  },
];

/** Made-up answers, as someone who's told Factwright about themselves would have them. */
const TOLD: AboutYou = readAnswers({
  you: {
    name: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '',
    location: 'Denver, CO',
    linkedin: 'linkedin.com/in/alex-rivera',
    website: '',
  },
  roles: ['Staff Engineer', 'Platform Engineer'],
  fields: ['software'],
  levels: ['senior', 'lead'],
  workplaces: ['remote'],
  remoteFrom: 'anywhere in the US',
  companies: ['startup', 'established'],
  industries: ['Developer tools', 'Climate'],
  employment: ['full-time'],
  minPay: '$170,000',
  targetPay: '$200,000',
  looks: [
    { layout: 'minimal', for: 'startup' },
    { layout: 'classic', for: 'established' },
  ],
  files: FILES,
  step: 6,
  reached: 6,
  startedOn: '2026-10-12',
});

/** The same, after adding a second kind of job: program manager jobs beside engineering ones. */
const TWO_KINDS: AboutYou = readAnswers({
  ...TOLD,
  firstKind: { id: 'developer', name: 'Developer' },
  otherKinds: [
    {
      id: 'project-manager',
      name: 'Project manager',
      roles: ['Technical Program Manager', 'Engineering Program Manager'],
      fields: ['product', 'operations'],
      levels: ['senior', 'lead'],
      minPay: '$160,000',
      targetPay: '$185,000',
      payFilter: false,
    },
  ],
});

const NOTES =
  'I lead the platform team at Tidewater Analytics. We moved twelve services onto one deploy pipeline last year, and deploys got about 40% faster.';

/** The templates the app comes with, as the profile lists them. */
const BUILT_IN: TemplateInfo[] = TEMPLATES.map(({ id, name, look }) => ({
  id,
  name,
  look,
  own: false,
  stamp: '',
}));

const STARTING: ProfileStatus['starting'] = [
  {
    path: 'base/startup-builder.json',
    kind: null,
    title: 'Staff Platform Engineer',
    layout: 'minimal',
    pdf: 'base/AlexRiveraResume_Startups.pdf',
    docx: null,
  },
  {
    path: 'base/big-company-leader.json',
    kind: null,
    title: 'Engineering Lead, Platform',
    layout: 'classic',
    pdf: 'base/AlexRiveraResume_Enterprise.pdf',
    docx: 'base/AlexRiveraResume_Enterprise.docx',
  },
];

const STATUS: Readonly<Record<string, Partial<ProfileStatus>>> = {
  new: { facts: { claims: 0, unconfirmed: 0, files: 0 } },
  started: { facts: { claims: 24, unconfirmed: 18, files: 5 }, unread: [] },
  done: {
    facts: { claims: 5, unconfirmed: 2, files: 5 },
    starting: STARTING,
    connections: { count: 412, added: '2026-10-12' },
  },
  kinds: {
    facts: { claims: 5, unconfirmed: 0, files: 5 },
    starting: [
      ...STARTING,
      {
        path: 'base/project-manager/big-company-leader.json',
        kind: 'project-manager',
        title: 'Technical Program Manager',
        layout: 'classic',
        pdf: 'base/project-manager/AlexRiveraResume_ProjectManager_Enterprise.pdf',
        docx: null,
      },
    ],
    connections: { count: 412, added: '2026-10-12' },
  },
};

/**
 * Sample answers about the user for checking the screens in a browser. ?profile=new starts with
 * nothing told, so getting started shows; started has Claude partway through the fact bank;
 * done, the default, has it finished; and kinds has two kinds of job, each with its starting
 * resumes. Changes stick until the page reloads.
 */
export function sampleProfile(state: string | null): ProfileApi {
  const kind = state && state in STATUS ? state : 'done';
  let answers: AboutYou = kind === 'new' ? readAnswers({}) : kind === 'kinds' ? TWO_KINDS : TOLD;
  let notes = kind === 'new' ? '' : NOTES;
  let confidential = kind === 'new' ? [] : ['Bluebird'];
  let templates: TemplateInfo[] = [
    ...BUILT_IN,
    ...(kind === 'new'
      ? []
      : [
          {
            id: 'navy-sidebar',
            name: 'Navy Sidebar',
            look: 'A navy column down the left with the contact details and skills.',
            own: true,
            stamp: '1',
          },
        ]),
  ];
  const listeners = new Set<(profile: Profile) => void>();
  const profile = (): Profile => ({
    answers,
    notes,
    confidential,
    templates,
    status: {
      facts: { claims: 0, unconfirmed: 0, files: 0 },
      starting: [],
      unread: [],
      notesChanged: false,
      criteria: kind === 'new' ? 'none' : 'app',
      connections: null,
      ...STATUS[kind],
    },
  });
  const changed = () => {
    for (const listener of listeners) listener(profile());
  };
  return {
    profile: async () => profile(),
    saveAnswers: async (changes) => {
      answers = applyChanges(answers, changes);
      return answers;
    },
    saveNotes: async (text) => {
      notes = text;
      return { ok: true };
    },
    changeConfidential: async ({ add, remove }) => {
      confidential = [...confidential.filter((name) => !remove.includes(name)), ...add];
      return confidential;
    },
    addFile: async (upload) => {
      const file: SharedFile = {
        path: `about-me/files/2026-10-12-${upload.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`,
        name: upload.name,
        kind: upload.kind,
        added: '2026-10-12',
        textFile: upload.text ? 'about-me/files/sample.md' : null,
      };
      answers = { ...answers, files: [...answers.files, file] };
      return { ok: true, file };
    },
    addLinkedIn: async () => {
      const file = FILES[1] as SharedFile;
      answers = {
        ...answers,
        files: [...answers.files.filter((each) => each.kind !== 'linkedin-data'), file],
      };
      return { ok: true, file };
    },
    removeFile: async (path) => {
      answers = { ...answers, files: answers.files.filter((file) => file.path !== path) };
      return answers;
    },
    startProfile: async () => {
      answers = { ...answers, startedOn: '2026-10-12' };
      setTimeout(changed, 0);
      return answers;
    },
    useAnswersForCriteria: async () => {},
    templatePreview: async () => ({ ok: true, data: samplePdf() }),
    addTemplate: async (upload) => {
      if (!/\.json$/i.test(upload.name))
        return { ok: true, kind: 'copy', source: '2026-10-12-1.pdf' };
      const name = upload.name.replace(/\.json$/i, '');
      templates = [
        ...templates,
        { id: name.toLowerCase(), name, look: 'A template someone shared.', own: true, stamp: '1' },
      ];
      setTimeout(changed, 0);
      return { ok: true, kind: 'template', id: name.toLowerCase(), name, already: false };
    },
    removeTemplate: async (id) => {
      templates = templates.filter((template) => template.id !== id || !template.own);
      answers = { ...answers, looks: answers.looks.filter((look) => look.layout !== id) };
      setTimeout(changed, 0);
      return { ok: true };
    },
    onProfileChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openTerminal: async () => ({ ok: true }),
  };
}
