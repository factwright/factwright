import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGES_QUESTION, PROFILE_PARTS, type ProfilePart } from '../../shared/profile-parts.ts';
import type { RunScope } from '../../shared/runs.ts';
import type { BoundProfileChanges } from '../about/profile-requests.ts';
import { AboutStore } from '../about/store.ts';
import type { JobsService } from '../jobs/service.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import { TemplateLibrary } from '../resume/templates.ts';
import { factwrightTools, PART_TOOLS, runHasTool } from './index.ts';
import { type McpTool, newCall, type ToolCall } from './mcp.ts';

let root: string;
let about: AboutStore;
let tools: McpTool[];
let kept: string[];

/** A run on a part of Profile, started from the user's words. */
function callFor(part: ProfilePart, changes = 'Change it', kind?: string): ToolCall {
  const bound: BoundProfileChanges = {
    part,
    changes,
    at: '2026-11-01T14:30:12.000Z',
    ...(kind && { kind }),
  };
  const scope: RunScope = `part:${part}`;
  return { ...newCall(scope, undefined, undefined, bound), keep: (path) => kept.push(path) };
}

const run = async (name: string, input: Record<string, unknown>, call: ToolCall) => {
  const found = tools.find((each) => each.name === name);
  if (!found) throw new Error(`No tool ${name}.`);
  return found.run(input, call);
};

const answersFile = () => JSON.parse(readFileSync(join(root, 'about-me', 'answers.json'), 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-parts-'));
  kept = [];
  about = new AboutStore({
    workspace: root,
    starterDir: join(root, 'no-starter'),
    today: () => '2026-11-01',
  });
  about.saveAnswers({
    you: {
      name: 'Alex Rivera',
      email: 'alex@example.com',
      phone: '',
      location: 'Denver, CO',
      linkedin: '',
      website: '',
    },
    roles: ['Staff Engineer'],
    levels: ['senior'],
    workplaces: ['remote'],
  });
  tools = factwrightTools({
    jobs: { list: () => ({ jobs: [] }) } as unknown as JobsService,
    about,
    facts: about.facts,
    workspace: root,
    printer: {} as ResumePrinter,
    templates: new TemplateLibrary({ workspace: root }),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('who has each part’s tool', () => {
  it.each([
    ['save_contact', 'about'],
    ['save_what_you_want', 'wants'],
    ['save_what_you_want', 'kind'],
    ['save_for_applications', 'applications'],
    ['save_for_applications', 'leaving'],
    ['save_beyond_work', 'beyond'],
    ['save_resume_choices', 'templates'],
    ['add_to_notes', 'shared'],
  ] as const)('%s is only for a run on its part: %s', (name, part) => {
    expect(runHasTool(`part:${part}`, name)).toBe(true);
    for (const scope of ['hunt', 'profile', 'history', 'revise', 'template'] as const) {
      expect(runHasTool(scope, name), scope).toBe(false);
    }
    for (const other of PROFILE_PARTS.filter((each) => !PART_TOOLS[each].includes(name))) {
      expect(runHasTool(`part:${other}`, name), other).toBe(false);
    }
  });

  it('a run on a part has nothing but that part’s, and what the user asked', () => {
    expect(
      tools
        .filter((tool) => runHasTool('part:about', tool.name))
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['about_you', 'requested_changes', 'save_contact']);
    for (const part of PROFILE_PARTS) {
      for (const name of ['read_page', 'read_posting', 'job_board', 'hn_jobs', 'save_about_you']) {
        expect(runHasTool(`part:${part}`, name), `${part}: ${name}`).toBe(false);
      }
    }
  });

  it('every tool a part names is one there is', () => {
    const names = tools.map((tool) => tool.name);
    for (const part of PROFILE_PARTS) {
      for (const name of PART_TOOLS[part]) expect(names, part).toContain(name);
    }
  });
});

describe('save_contact', () => {
  it('saves only the details given, name included, and keeps the file for Undo', async () => {
    const text = await run(
      'save_contact',
      { name: ' Sam Rivera ', email: 'sam@example.com' },
      callFor('about'),
    );
    expect(text).toBe('Saved to the user’s Profile: Name: Sam Rivera; Email: sam@example.com.');
    expect(about.answers().you).toMatchObject({
      name: 'Sam Rivera',
      email: 'sam@example.com',
      location: 'Denver, CO',
    });
    expect(kept.some((path) => path.endsWith(join('about-me', 'answers.json')))).toBe(true);
  });

  it('clears a detail, but never the name', async () => {
    await run('save_contact', { location: '' }, callFor('about'));
    expect(about.answers().you.location).toBe('');
    await expect(run('save_contact', { name: '  ' }, callFor('about'))).rejects.toThrow(
      'their name can’t be blank',
    );
    expect(about.answers().you.name).toBe('Alex Rivera');
  });

  it('refuses what isn’t a contact detail, with nothing saved', async () => {
    await expect(
      run('save_contact', { email: 'a@b.c', targetPay: '$1' }, callFor('about')),
    ).rejects.toThrow('targetPay isn’t part of About you');
    expect(about.answers().you.email).toBe('alex@example.com');
    await expect(run('save_contact', {}, callFor('about'))).rejects.toThrow('Give what to change');
  });
});

describe('save_what_you_want', () => {
  it('replaces what it names, and nothing else', async () => {
    const text = await run(
      'save_what_you_want',
      { workplaces: ['hybrid'], mustHaves: 'A four-day week', roles: ['Principal Engineer'] },
      callFor('wants'),
    );
    expect(text).toContain('How they’d work: hybrid');
    expect(text).toContain('Must-haves: A four-day week');
    const answers = about.answers();
    expect(answers.workplaces).toEqual(['hybrid']);
    expect(answers.mustHaves).toBe('A four-day week');
    expect(answers.roles).toEqual(['Principal Engineer']);
    expect(answers.levels).toEqual(['senior']);
  });

  it('refuses to name the only kind of job, which has no name until there’s a second', async () => {
    await expect(run('save_what_you_want', { name: 'Engineer' }, callFor('wants'))).rejects.toThrow(
      'with one kind of job, it has no name',
    );
  });

  it('refuses a value it doesn’t know, with nothing saved', async () => {
    await expect(
      run('save_what_you_want', { levels: ['wizard'], mustHaves: 'Hm' }, callFor('wants')),
    ).rejects.toThrow('doesn’t hold up');
    expect(about.answers().mustHaves).toBe('');
  });

  it('adds a kind of job, naming the first, and removes one', async () => {
    const added = await run(
      'save_what_you_want',
      {
        firstKindName: 'Engineer',
        addKinds: [{ name: 'Project manager', roles: ['Program Manager'], levels: ['lead'] }],
      },
      callFor('wants'),
    );
    expect(added).toContain('New kind of job: Project manager (`project-manager`)');
    expect(about.answers().firstKind).toMatchObject({ name: 'Engineer' });
    expect(about.answers().otherKinds).toMatchObject([
      { id: 'project-manager', roles: ['Program Manager'], levels: ['lead'] },
    ]);
    // With more than one, a kind's own says which.
    await expect(run('save_what_you_want', { roles: ['Staff'] }, callFor('wants'))).rejects.toThrow(
      'give kind',
    );
    await run(
      'save_what_you_want',
      { kind: 'project-manager', targetPay: '$170,000' },
      callFor('wants'),
    );
    expect(about.answers().otherKinds[0]?.targetPay).toBe('$170,000');
    expect(about.answers().targetPay).toBe('');
    await expect(
      run('save_what_you_want', { removeKinds: [about.answers().firstKind?.id] }, callFor('wants')),
    ).rejects.toThrow('The first stays');
    await run('save_what_you_want', { removeKinds: ['project-manager'] }, callFor('wants'));
    expect(about.answers().otherKinds).toEqual([]);
  });

  describe('in a run on one kind of job', () => {
    beforeEach(async () => {
      await run(
        'save_what_you_want',
        { firstKindName: 'Engineer', addKinds: [{ name: 'Project manager' }] },
        callFor('wants'),
      );
    });
    const onKind = () => callFor('kind', 'Change it', 'project-manager');

    it('changes that kind’s own answers and name', async () => {
      await run(
        'save_what_you_want',
        { roles: ['Program Director'], name: 'Program lead' },
        onKind(),
      );
      expect(about.answers().otherKinds[0]).toMatchObject({
        id: 'project-manager',
        name: 'Program lead',
        roles: ['Program Director'],
      });
      expect(about.answers().roles).toEqual(['Staff Engineer']);
    });

    it('changes no other kind, nor what they share', async () => {
      await expect(
        run('save_what_you_want', { kind: 'engineer', roles: ['X'] }, onKind()),
      ).rejects.toThrow('this run is on the kind of job `project-manager`');
      await expect(run('save_what_you_want', { workplaces: ['onsite'] }, onKind())).rejects.toThrow(
        'workplaces isn’t part of this kind of job',
      );
      await expect(
        run('save_what_you_want', { removeKinds: ['project-manager'] }, onKind()),
      ).rejects.toThrow('removeKinds isn’t part of this kind of job');
      expect(about.answers().workplaces).toEqual(['remote']);
    });
  });
});

describe('save_for_applications', () => {
  it('saves a field at a time, over what’s there', async () => {
    about.saveAnswers({
      applications: { ...about.answers().applications, city: 'Denver', pronouns: 'she/her' },
    });
    const text = await run(
      'save_for_applications',
      { city: 'Austin', countries: ['United States'], sponsorship: 'no' },
      callFor('applications'),
    );
    expect(text).toContain('City: Austin');
    expect(about.answers().applications).toMatchObject({
      city: 'Austin',
      pronouns: 'she/her',
      countries: ['United States'],
      sponsorship: 'no',
    });
  });

  it.each([
    'street',
    'streetAddress',
    'address',
    'postalCode',
    'postal_code',
    'zip',
    'equalOpportunity',
    'gender',
    'race',
    'hispanic',
    'veteran',
    'disability',
  ])('turns away %s, which stays on this computer, and saves nothing', async (key) => {
    await expect(
      run(
        'save_for_applications',
        { city: 'Austin', [key]: 'Something private' },
        callFor('applications'),
      ),
    ).rejects.toThrow('stay on this computer');
    expect(about.answers().applications.city).toBe('');
    expect(readFileSync(join(root, 'about-me', 'answers.json'), 'utf8')).not.toContain(
      'Something private',
    );
  });

  it('refuses what doesn’t hold up', async () => {
    await expect(
      run('save_for_applications', { sponsorship: 'maybe' }, callFor('applications')),
    ).rejects.toThrow('Not saved');
    await expect(
      run('save_for_applications', { leaving: 'x'.repeat(1001) }, callFor('applications')),
    ).rejects.toThrow('Not saved');
  });

  it('in a run on why they’re leaving, changes that alone', async () => {
    const text = await run(
      'save_for_applications',
      { leaving: 'I want a bigger scale.' },
      callFor('leaving'),
    );
    expect(text).toContain('Why they’re leaving: I want a bigger scale.');
    expect(about.answers().applications.leaving).toBe('I want a bigger scale.');
    await expect(
      run('save_for_applications', { city: 'Austin' }, callFor('leaving')),
    ).rejects.toThrow('city isn’t part of why they’re leaving');
  });
});

describe('save_beyond_work', () => {
  it('adds, changes and removes projects by their ids, in Beyond work’s own file', async () => {
    await run(
      'save_beyond_work',
      { addProjects: [{ name: 'Trailhead', kind: 'product', what: 'Maps trails.' }] },
      callFor('beyond'),
    );
    const [project] = about.answers().projects;
    expect(project).toMatchObject({ id: 'trailhead', name: 'Trailhead', showing: 'fit' });
    await run(
      'save_beyond_work',
      { changeProjects: [{ id: 'trailhead', status: 'done', showing: 'private' }] },
      callFor('beyond'),
    );
    expect(about.answers().projects[0]).toMatchObject({ status: 'done', showing: 'private' });
    // Kept in its own file, so the card lists that one too.
    const file = JSON.parse(readFileSync(join(root, 'about-me', 'beyond-work.json'), 'utf8'));
    expect(file.projects[0].id).toBe('trailhead');
    expect(answersFile()).not.toHaveProperty('projects');
    await run('save_beyond_work', { removeProjects: ['trailhead'] }, callFor('beyond'));
    expect(about.answers().projects).toEqual([]);
  });

  it('refuses a project that isn’t there, and one with no name', async () => {
    await expect(
      run(
        'save_beyond_work',
        { changeProjects: [{ id: 'nope', status: 'done' }] },
        callFor('beyond'),
      ),
    ).rejects.toThrow('no project `nope`');
    await expect(
      run('save_beyond_work', { removeProjects: ['nope'] }, callFor('beyond')),
    ).rejects.toThrow('no project `nope`');
    await expect(
      run('save_beyond_work', { addProjects: [{ what: 'Nameless' }] }, callFor('beyond')),
    ).rejects.toThrow('a name');
  });

  it('replaces who they are outside work, so one can go', async () => {
    about.saveAnswers({ interests: ['Chess', 'Running'] });
    await run(
      'save_beyond_work',
      { interests: ['Running'], interestsOnResumes: 'always', cares: 'Access to books' },
      callFor('beyond'),
    );
    expect(about.answers()).toMatchObject({
      interests: ['Running'],
      interestsOnResumes: 'always',
      cares: 'Access to books',
    });
  });

  it('sets how projects look a choice at a time, and refuses one that doesn’t hold up', async () => {
    await run(
      'save_beyond_work',
      { projectPrefs: { resumes: 'experience', tools: true } },
      callFor('beyond'),
    );
    expect(about.answers().projectPrefs).toMatchObject({
      resumes: 'experience',
      tools: true,
      links: true,
    });
    await expect(
      run('save_beyond_work', { projectPrefs: { resumes: 'everywhere' } }, callFor('beyond')),
    ).rejects.toThrow('projectPrefs takes');
    await expect(
      run('save_beyond_work', { projectPrefs: { color: 'red' } }, callFor('beyond')),
    ).rejects.toThrow('projectPrefs takes');
    expect(about.answers().projectPrefs.resumes).toBe('experience');
  });
});

describe('save_resume_choices', () => {
  it('saves the templates picked, how long, and which files', async () => {
    const text = await run(
      'save_resume_choices',
      { looks: [{ layout: 'minimal', for: 'startup' }], pages: 1, format: 'both' },
      callFor('templates'),
    );
    expect(text).toBe(
      'Saved to the user’s Profile: Templates: minimal for startup; Length: one page; Files: Both.',
    );
    expect(about.answers()).toMatchObject({
      looks: [{ layout: 'minimal', for: 'startup' }],
      pages: 1,
      format: 'both',
    });
    await run('save_resume_choices', { pages: null }, callFor('templates'));
    expect(about.answers().pages).toBeNull();
  });

  it('refuses a template the app doesn’t have', async () => {
    await expect(
      run(
        'save_resume_choices',
        { looks: [{ layout: 'made-up', for: 'any' }] },
        callFor('templates'),
      ),
    ).rejects.toThrow('no template `made-up`');
    expect(about.answers().looks).toEqual([]);
  });
});

describe('add_to_notes', () => {
  it('adds what the user typed, as they typed it, after what’s there', async () => {
    about.saveNotes('What I do now: lead a team.');
    const call = callFor('shared', 'Add to my notes: I mentor two juniors.');
    expect(await run('add_to_notes', { text: 'I mentor two juniors.' }, call)).toBe(
      'Added to the user’s notes: “I mentor two juniors.”.',
    );
    expect(about.notes()).toBe('What I do now: lead a team.\n\nI mentor two juniors.\n');
    expect(kept.some((path) => path.endsWith(join('about-me', 'notes.md')))).toBe(true);
  });

  it('takes nothing the user didn’t say, such as what a file told Claude', async () => {
    const call = callFor('shared', 'Add that I mentor two juniors.');
    await expect(run('add_to_notes', { text: 'I led a team of forty.' }, call)).rejects.toThrow(
      'the user’s own words',
    );
    await expect(run('add_to_notes', { text: 'They mentor two juniors.' }, call)).rejects.toThrow(
      'the user’s own words',
    );
    expect(about.notes()).toBe('');
  });
});

describe('the fact tools, from what the user typed', () => {
  const FACT = {
    file: 'facts/projects.md',
    title: 'Billing rewrite went live',
    status: 'live',
    confidence: 'high',
    wording: 'Rewrote billing, which went live in March and cut costs about 20%.',
    keywords: 'billing',
    questions: [CHANGES_QUESTION],
  };

  /** A call as Claude Code shows it first, from the run's own Claude, as its hook does. */
  const saveFact = (input: Record<string, unknown>, call: ToolCall) => {
    call.questions.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__factwright__save_fact',
      tool_input: input,
    });
    return run('save_fact', input, call);
  };

  const WORDS = 'The billing rewrite went live in March, and it cut costs about 20%.';

  it('saves it as they said it, unverified, with their words beside it', async () => {
    mkdirSync(join(root, 'facts'), { recursive: true });
    writeFileSync(join(root, 'facts', 'projects.md'), '# Projects\n');
    const text = await saveFact(FACT, callFor('facts', WORDS));
    expect(text).toContain('Saved “Billing rewrite went live” in facts/projects.md, unverified');
    const file = readFileSync(join(root, 'facts', 'projects.md'), 'utf8');
    expect(file).toContain('`unconfirmed`');
    expect(file).toContain(CHANGES_QUESTION);
    expect(file).toContain(WORDS);
  });

  it('refuses a number they didn’t give', async () => {
    await expect(
      saveFact(
        { ...FACT, wording: 'Rewrote billing, which cut costs about 45%.' },
        callFor('facts', WORDS),
      ),
    ).rejects.toThrow('45 isn’t in the user’s answer');
  });

  it('never lets their typed words verify a fact or correct a verified one', async () => {
    mkdirSync(join(root, 'facts'), { recursive: true });
    writeFileSync(
      join(root, 'facts', 'acme.md'),
      '# Acme\n\n### Deploys\n`live` `solo` `high`\n> Cut deploy time about 40%.\n- **Source:** Alex 2026-10-01\n',
    );
    const call = callFor('facts', 'Deploys was 35%, not 40%.');
    const input = {
      file: 'facts/acme.md',
      title: 'Deploys',
      wording: 'Cut deploy time about 35%.',
      questions: [CHANGES_QUESTION],
    };
    call.questions.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__factwright__correct_fact',
      tool_input: input,
    });
    await expect(run('correct_fact', input, call)).rejects.toThrow('doesn’t name “Deploys”');
    expect(readFileSync(join(root, 'facts', 'acme.md'), 'utf8')).toContain('about 40%');
  });
});
