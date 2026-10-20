import { PAGE_SHAPES } from '@factwright/engine';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  mergeChanges,
  NO_ANSWERS,
  parseAnswerChanges,
  readAnswers,
} from './about.ts';
import {
  BEYOND_LIMITS,
  beyondFileWith,
  DEFAULT_PROJECT_PREFS,
  freshProjectId,
  localTime,
  NO_BEYOND,
  newProject,
  PAGE_SHAPE_CHOICES,
  type Project,
  projectIdFor,
  readProjectPrefs,
} from './beyond.ts';

const trailhead: Project = {
  ...newProject('trailhead'),
  name: 'Trailhead',
  kind: 'product',
  what: 'A free app that maps trail conditions.',
  status: 'live',
  showing: 'feature',
};

describe('Beyond work in the answers', () => {
  it('starts with nothing told, and resumes showing projects as they always have', () => {
    expect(NO_ANSWERS).toMatchObject(NO_BEYOND);
    expect(NO_BEYOND.projectPrefs).toEqual({
      resumes: 'section',
      heading: '',
      detail: 'line',
      links: true,
      numbers: true,
      tools: false,
      page: 'list',
    });
  });

  it('keeps each project that holds up, with what it doesn’t say as nothing told', () => {
    const answers = readAnswers({
      projects: [
        { id: 'trailhead', name: 'Trailhead', kind: 'a-later-kind', links: ['trailhead.app'] },
        { id: '../club', name: 'Code Club' },
        { name: 'No id' },
        { id: 'trailhead', name: 'Twice' },
      ],
      interests: ['Chess', ' chess ', ''],
      cares: 'x'.repeat(5000),
      interestsOnResumes: 'sometimes',
    });
    expect(answers.projects).toEqual([
      { ...newProject('trailhead'), name: 'Trailhead', links: ['trailhead.app'] },
    ]);
    expect(answers.interests).toEqual(['Chess']);
    expect(answers.cares).toBe('');
    expect(answers.interestsOnResumes).toBe('never');
  });

  it('keeps a project private when how much to show it doesn’t read, as a later version’s', () => {
    for (const showing of ['Private', 'hidden', ' private', null, 42]) {
      expect(readAnswers({ projects: [{ id: 'club', showing }] }).projects[0]?.showing).toBe(
        'private',
      );
    }
    // Saying nothing about it is a project just told, shown when it fits.
    expect(readAnswers({ projects: [{ id: 'club' }] }).projects[0]?.showing).toBe('fit');
  });

  it('keeps no more projects than the app holds', () => {
    const many = Array.from({ length: 40 }, (_, n) => ({ id: `p-${n}`, name: `P ${n}` }));
    expect(readAnswers({ projects: many }).projects).toHaveLength(BEYOND_LIMITS.projects);
  });

  it('reads how projects look on resumes a choice at a time, as it’s always been where it can’t', () => {
    expect(readProjectPrefs({ resumes: 'experience', tools: true })).toEqual({
      ...DEFAULT_PROJECT_PREFS,
      resumes: 'experience',
      tools: true,
    });
    // One choice it can't read, such as a later version's, leaves the rest as they are.
    expect(
      readProjectPrefs({ resumes: 'sidebar', heading: 'Selected Work', links: false }),
    ).toEqual({ ...DEFAULT_PROJECT_PREFS, heading: 'Selected Work', links: false });
    expect(readProjectPrefs({ heading: 'x'.repeat(61) })).toEqual(DEFAULT_PROJECT_PREFS);
    expect(readProjectPrefs('section')).toBeUndefined();
    expect(readProjectPrefs({ page: 'slides' })).toBeUndefined();
  });

  it('offers the Projects page shapes the engine lays out', () => {
    expect(PAGE_SHAPE_CHOICES.map(([value]) => value)).toEqual([...PAGE_SHAPES]);
  });
});

describe('changing projects', () => {
  it('takes projects added only whole, changed a field at a time, and removed by id', () => {
    expect(parseAnswerChanges({ addedProjects: [{ id: 'trailhead', name: 'Trailhead' }] })).toEqual(
      { addedProjects: [{ ...newProject('trailhead'), name: 'Trailhead' }] },
    );
    expect(parseAnswerChanges({ addedProjects: [{ id: 'x', kind: 'wizardry' }] })).toBeNull();
    expect(
      parseAnswerChanges({ projectChanges: [{ id: 'trailhead', showing: 'private' }] }),
    ).toEqual({ projectChanges: [{ id: 'trailhead', showing: 'private' }] });
    for (const projectChanges of [
      [{ name: 'No id' }],
      [{ id: 'trailhead', showing: 'loudly' }],
      [{ id: 'trailhead', quiet: true }],
      [{ id: 'trailhead' }, { id: 'trailhead' }],
      'trailhead',
    ]) {
      expect(parseAnswerChanges({ projectChanges })).toBeNull();
    }
    expect(parseAnswerChanges({ removedProjects: ['trailhead'] })).toEqual({
      removedProjects: ['trailhead'],
    });
    expect(parseAnswerChanges({ removedProjects: ['../base'] })).toBeNull();
    // The whole list never comes from the window: it could undo changes made meanwhile.
    expect(parseAnswerChanges({ projects: [trailhead] })).toBeNull();
    // The rest of Beyond work comes whole.
    expect(parseAnswerChanges({ interests: ['Chess'], interestsOnResumes: 'fit' })).toEqual({
      interests: ['Chess'],
      interestsOnResumes: 'fit',
    });
    expect(parseAnswerChanges({ projectPrefs: { resumes: 'off' } })).toEqual({
      projectPrefs: { ...DEFAULT_PROJECT_PREFS, resumes: 'off' },
    });
  });

  it('changes one project without undoing a change made to another meanwhile', () => {
    const club = { ...newProject('club'), name: 'Code Club' };
    const answers = readAnswers({ projects: [trailhead, club] });
    // Another computer changed the club while this one changed Trailhead.
    const elsewhere = applyChanges(answers, { projectChanges: [{ id: 'club', when: '2022' }] });
    const mine = applyChanges(elsewhere, {
      projectChanges: [{ id: 'trailhead', showing: 'fit' }],
    });
    expect(mine.projects).toEqual([
      { ...trailhead, showing: 'fit' },
      { ...club, when: '2022' },
    ]);
    // A change to a project that's gone does nothing, and one added twice is there once.
    const gone = applyChanges(mine, {
      removedProjects: ['club'],
      projectChanges: [{ id: 'club', name: 'Back again' }],
      addedProjects: [trailhead],
    });
    expect(gone.projects).toEqual([{ ...trailhead, showing: 'fit' }]);
  });

  it('joins edits typed one after another, as one save', () => {
    const added = { ...newProject('club'), name: 'Code Club' };
    const joined = mergeChanges(
      mergeChanges(
        { addedProjects: [added], projectChanges: [{ id: 'trailhead', when: '2023' }] },
        { projectChanges: [{ id: 'club', role: 'Started it' }] },
      ),
      { projectChanges: [{ id: 'trailhead', status: 'done' }], interests: ['Chess'] },
    );
    expect(joined).toEqual({
      addedProjects: [{ ...added, role: 'Started it' }],
      projectChanges: [{ id: 'trailhead', when: '2023', status: 'done' }],
      interests: ['Chess'],
    });
    // Removing a project added since the last save takes its add and its changes with it.
    expect(mergeChanges(joined, { removedProjects: ['club', 'trailhead'] })).toEqual({
      removedProjects: ['club', 'trailhead'],
      interests: ['Chess'],
    });
  });

  it('gives each new project an id none of the others has, and never one just removed', () => {
    const rolls = [0.5, 0.5, 0.25];
    const random = () => rolls.shift() ?? 0.75;
    // The same roll twice: the second, already taken, is passed over.
    const first = freshProjectId([], random);
    expect(first).toMatch(/^project-[a-z0-9]+$/);
    expect(freshProjectId([first], random)).not.toBe(first);
    expect(projectIdFor('Trailhead', [])).toBe('trailhead');
    expect(projectIdFor('Trailhead', ['trailhead', 'trailhead-2'])).toBe('trailhead-3');
    expect(projectIdFor('株式会社', [])).toBe('project');
  });
});

describe('beyondFileWith', () => {
  it('writes nothing when nothing changed', () => {
    expect(beyondFileWith({ pets: ['A dog'] }, NO_BEYOND, NO_BEYOND, 'now')).toBeNull();
  });

  it('writes how projects look a choice at a time, over choices it doesn’t know', () => {
    const raw = { projectPrefs: { resumes: 'experience', page: 'timeline', order: 'newest' } };
    const prefs = readProjectPrefs(raw.projectPrefs) ?? DEFAULT_PROJECT_PREFS;
    const before = { ...NO_BEYOND, projectPrefs: prefs };
    const after = { ...before, projectPrefs: { ...prefs, heading: 'Selected Work' } };
    expect(beyondFileWith(raw, before, after, 'now')).toEqual({
      projectPrefs: {
        resumes: 'experience',
        page: 'timeline',
        order: 'newest',
        heading: 'Selected Work',
      },
    });
  });

  it('keeps the time the projects changed on the user’s own calendar, with its offset', () => {
    expect(localTime(new Date(2026, 9, 21, 8, 5, 9))).toMatch(
      /^2026-10-21T08:05:09[+-]\d{2}:\d{2}$/,
    );
    const time = localTime(new Date('2026-10-20T23:00:00Z'));
    expect(new Date(time).toISOString()).toBe('2026-10-20T23:00:00.000Z');
  });

  it('notes when the projects changed, and only then', () => {
    const interests = beyondFileWith({}, NO_BEYOND, { ...NO_BEYOND, interests: ['Chess'] }, 'now');
    expect(interests).toEqual({ interests: ['Chess'] });
    const projects = beyondFileWith({}, NO_BEYOND, { ...NO_BEYOND, projects: [trailhead] }, 'now');
    expect(projects).toEqual({ projects: [trailhead], projectsChanged: 'now' });
  });
});
