// A made-up job hunt in Factwright on a computer, synced to an account on a local copy of the sync
// server with the app's own sync, for the runs that fill a form through sync, as in a browser on a
// computer without Factwright.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_EQUAL_OPPORTUNITY } from '@factwright/core';
import type { TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  type Bytes,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
} from '@factwright/sync';
import { PrivateAnswers } from '../../desktop/src/main/about/private.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { SyncEngine } from '../../desktop/src/main/sync/engine.ts';
import { SyncState } from '../../desktop/src/main/sync/state.ts';

const DESKTOP = fileURLToPath(new URL('../../desktop', import.meta.url));

/** The job's folder in the workspace. */
export const FOLDER = '2026-10-20-northwind-labs-senior-product-manager';

/** A made-up resume the engine printed, as the desktop app's tests use. */
export const PDF = readFileSync(
  createRequire(join(DESKTOP, 'package.json')).resolve('@factwright/xray/fixtures/engineer.pdf'),
);

export interface SyncedHunt {
  /** The account, its key, and the keys made from it. */
  sam: Awaited<ReturnType<TestServer['signUp']>>;
  accountKey: Bytes;
  keys: AccountKeys;
  workspace: string;
  tracker: Tracker;
  jobs: JobsService;
  /** Syncs the computer with the account, as the app does, and reads its workspace again. */
  sync(): Promise<void>;
  /** A link code for the extension, as Factwright's Sync settings shows one. */
  linkCode(): Promise<string>;
}

/**
 * Factwright on a computer, in `home`, with a job hunt synced to a new account: Profile, with an
 * equal-opportunity answer kept on the computer alone, as Factwright keeps it, and the job whose
 * application is at `apply`, with its resume, saved from its form's page.
 */
export async function syncedHunt(
  server: TestServer,
  home: string,
  apply: string,
): Promise<SyncedHunt> {
  const workspace = join(home, 'workspace');
  const write = (path: string, contents: string | Buffer) => {
    const file = join(workspace, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  write(
    'about-me/answers.json',
    `${JSON.stringify(
      {
        you: {
          name: 'Ana María Ruiz',
          email: 'ana@example.com',
          phone: '(303) 555-0142',
          location: 'Denver, CO',
          linkedin: 'https://www.linkedin.com/in/anaruiz',
          website: 'https://anaruiz.dev',
        },
        applications: {
          pronouns: 'She/her',
          github: 'https://github.com/anaruiz',
          country: 'United States',
          countries: ['United States'],
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    `applications/${FOLDER}/job.md`,
    [
      '# Northwind Labs: Senior Product Manager, Data',
      '',
      '- **Date:** 2026-10-20',
      `- **Apply:** Lever ${apply}`,
    ].join('\n'),
  );
  write(
    `applications/${FOLDER}/resume.json`,
    JSON.stringify({
      name: 'Ana María Ruiz',
      headline: 'Product manager',
      summary: 'Ships data products.',
      layout: 'classic',
      output_name: 'AnaRuizResume10202026_Northwind',
      experience: [
        {
          title: 'Senior Product Manager',
          company: 'Tidewater Analytics',
          start: '2021',
          end: 'Present',
        },
      ],
    }),
  );
  write(`applications/${FOLDER}/AnaRuizResume10202026_Northwind.pdf`, PDF);
  // Kept beside the tracker, never in the workspace, so it never syncs.
  new PrivateAnswers(join(home, 'private-answers.json')).save({
    equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, gender: 'woman' },
  });
  const tracker = new Tracker(join(home, 'tracker.db'));
  const jobs = new JobsService({ workspace, tracker, onChange: () => {} });
  jobs.read();

  const sam = await server.signUp();
  const accountKey = newAccountKey();
  const keys = await accountKeys(accountKey);
  await sam.client.saveKeys(keys.id, await lockWithRecoveryKey(accountKey, newRecoveryKey().bytes));
  const computer = await server.newSession(sam.id);
  const engine = new SyncEngine({
    client: computer.client,
    keys,
    state: new SyncState(join(home, 'sync.db')),
    tracker,
    workspace,
    device: 'Ana’s MacBook Pro',
  });
  const sync = async () => {
    await engine.syncOnce();
    jobs.read();
  };
  await sync();
  return {
    sam,
    accountKey,
    keys,
    workspace,
    tracker,
    jobs,
    sync,
    linkCode: async () => {
      const code = newLinkCode();
      const link = await lockForLink(accountKey, code.bytes);
      await sam.client.saveLink(link.id, link.data);
      return code.text;
    },
  };
}
