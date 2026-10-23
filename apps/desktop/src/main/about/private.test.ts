import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_EQUAL_OPPORTUNITY, NO_PRIVATE } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRIVATE_FILE, parsePrivateChanges, readPrivate } from '../../shared/private.ts';
import { PrivateAnswers } from './private.ts';

let folder: string;
let file: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'factwright-private-'));
  file = join(folder, PRIVATE_FILE);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('what Profile keeps on this computer alone', () => {
  it('is nothing told before anything is saved', () => {
    expect(new PrivateAnswers(file).read()).toEqual(NO_PRIVATE);
  });

  it('keeps the street, postal code and equal-opportunity answers, readable only by you', () => {
    const kept = new PrivateAnswers(file);
    kept.save({ street: '1420 Larimer St' });
    kept.save({ equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, veteran: 'decline' } });
    expect(new PrivateAnswers(file).read()).toEqual({
      street: '1420 Larimer St',
      postalCode: '',
      equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, veteran: 'decline' },
    });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).street).toBe('1420 Larimer St');
  });

  it('reads a file that doesn’t hold up part by part, so one bad part loses nothing else', () => {
    writeFileSync(
      file,
      JSON.stringify({ street: 7, postalCode: '80202', equalOpportunity: { gender: 'robot' } }),
    );
    expect(new PrivateAnswers(file).read()).toEqual({ ...NO_PRIVATE, postalCode: '80202' });
    writeFileSync(file, 'not JSON');
    expect(new PrivateAnswers(file).read()).toEqual(NO_PRIVATE);
    expect(readPrivate(null)).toEqual(NO_PRIVATE);
  });

  it('takes changes from the window only whole and as Profile offers them', () => {
    expect(parsePrivateChanges({ postalCode: '80202' })).toEqual({ postalCode: '80202' });
    expect(
      parsePrivateChanges({ equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, race: 'asian' } }),
    ).toEqual({ equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, race: 'asian' } });
    expect(parsePrivateChanges({ equalOpportunity: { gender: 'robot' } })).toBeNull();
    expect(parsePrivateChanges({ password: 'x' })).toBeNull();
    expect(parsePrivateChanges({ street: 'x'.repeat(201) })).toBeNull();
    expect(parsePrivateChanges([])).toBeNull();
  });
});
