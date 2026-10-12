import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyStarter } from './starter.ts';

let root: string;
const starter = () => join(root, 'starter');
const workspace = () => join(root, 'workspace');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-starter-'));
  mkdirSync(join(starter(), 'guide', 'styles'), { recursive: true });
  writeFileSync(join(starter(), 'README.md'), 'About the starter folder');
  writeFileSync(join(starter(), 'guide', 'rules.md'), 'Starter rules');
  writeFileSync(join(starter(), 'guide', 'styles', 'startup.md'), 'Startup style');
  mkdirSync(join(workspace(), 'guide'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it('copies the starter files a workspace lacks, and never replaces one that’s there', () => {
  writeFileSync(join(workspace(), 'guide', 'rules.md'), 'My own rules');
  expect(copyStarter(starter(), workspace())).toEqual(['guide/styles/startup.md']);
  expect(readFileSync(join(workspace(), 'guide', 'rules.md'), 'utf8')).toBe('My own rules');
  expect(readFileSync(join(workspace(), 'guide', 'styles', 'startup.md'), 'utf8')).toBe(
    'Startup style',
  );
  // The folder's own README explains the folder, and stays out of the workspace.
  expect(() => readFileSync(join(workspace(), 'README.md'))).toThrow();
  expect(copyStarter(starter(), workspace())).toEqual([]);
});
