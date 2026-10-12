import { type AboutYou, readAnswers, type SharedFile } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { Profile, ProfileStatus } from '../../shared/profile.ts';
import { samplePdf } from '../jobs/sample-pdf.ts';

type ProfileApi = Pick<
  FactwrightApi,
  | 'profile'
  | 'saveAnswers'
  | 'saveNotes'
  | 'saveConfidential'
  | 'addFile'
  | 'addLinkedIn'
  | 'removeFile'
  | 'startProfile'
  | 'useAnswersForCriteria'
  | 'templatePreview'
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
    { layout: 'timeline', for: 'startup' },
    { layout: 'executive', for: 'established' },
  ],
  files: FILES,
  step: 6,
  reached: 6,
  startedOn: '2026-10-12',
});

const NOTES =
  'I lead the platform team at Tidewater Analytics. We moved twelve services onto one deploy pipeline last year, and deploys got about 40% faster.';

const STATUS: Readonly<Record<string, Partial<ProfileStatus>>> = {
  new: { facts: { claims: 0, unconfirmed: 0, files: 0 } },
  started: { facts: { claims: 24, unconfirmed: 18, files: 5 }, unread: [] },
  done: {
    facts: { claims: 41, unconfirmed: 0, files: 7 },
    starting: [
      {
        path: 'base/startup-builder.json',
        title: 'Staff Platform Engineer',
        layout: 'timeline',
        pdf: 'base/AlexRiveraResume_Startups.pdf',
        docx: null,
      },
      {
        path: 'base/big-company-leader.json',
        title: 'Engineering Lead, Platform',
        layout: 'executive',
        pdf: 'base/AlexRiveraResume_Enterprise.pdf',
        docx: 'base/AlexRiveraResume_Enterprise.docx',
      },
    ],
    connections: { count: 412, added: '2026-10-12' },
  },
};

/**
 * Sample answers about the user for checking the screens in a browser. ?profile=new starts with
 * nothing told, so getting started shows; started has Claude partway through the fact bank; and
 * done, the default, has it finished. Changes stick until the page reloads.
 */
export function sampleProfile(state: string | null): ProfileApi {
  const kind = state && state in STATUS ? state : 'done';
  let answers: AboutYou = kind === 'new' ? readAnswers({}) : TOLD;
  let notes = kind === 'new' ? '' : NOTES;
  let confidential = kind === 'new' ? [] : ['Bluebird'];
  const listeners = new Set<(profile: Profile) => void>();
  const profile = (): Profile => ({
    answers,
    notes,
    confidential,
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
      answers = { ...answers, ...changes };
      return answers;
    },
    saveNotes: async (text) => {
      notes = text;
      return { ok: true };
    },
    saveConfidential: async (names) => {
      confidential = names;
      return names;
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
    onProfileChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openTerminal: async () => ({ ok: true }),
  };
}
