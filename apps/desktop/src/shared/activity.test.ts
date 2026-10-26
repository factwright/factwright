import { describe, expect, it } from 'vitest';
import {
  helperKind,
  helpersWords,
  type RunHelper,
  stepKind,
  stepWords,
  type TodoItem,
  type TodoState,
  todoAt,
  todoWords,
} from './activity.ts';

const words = (tool: string, detail: string | null = null) => stepWords({ tool, detail });

describe('stepWords', () => {
  it('says what Factwright’s tools do', () => {
    expect(words('mcp__factwright__build_resume')).toEqual({
      doing: 'Building the resume',
      did: 'Built the resume',
    });
    expect(words('mcp__factwright__read_page', 'acme.com')?.doing).toBe('Reading acme.com');
    expect(words('mcp__factwright__read_page')?.did).toBe('Read a page');
    expect(words('mcp__factwright__a_tool_from_later')).toBeNull();
  });

  it('says what reading and writing in the workspace is, by where the file is', () => {
    expect(words('Read', 'facts/platform.md')?.doing).toBe('Reading your fact bank');
    expect(words('Edit', 'facts/platform.md')?.doing).toBe('Updating your fact bank');
    expect(words('Read', 'applications/acme--staff/posting.md')?.did).toBe('Read the posting');
    expect(words('Write', 'applications/acme--staff/resume.json')?.doing).toBe(
      'Writing the resume',
    );
    expect(words('Write', 'applications/acme--staff/cover-letter.json')?.did).toBe(
      'Wrote the cover letter',
    );
    expect(words('Write', 'searches/2026-11-hn/jobs.json')?.doing).toBe('Saving the jobs it found');
    // Anything else, by its name.
    expect(words('Read', 'applications/acme--staff/extra.md')?.doing).toBe('Reading extra.md');
    expect(words('Write', 'hosts')?.did).toBe('Wrote hosts');
    expect(words('Read')?.doing).toBe('Reading a file');
  });

  it('says what searching and reading the web is', () => {
    expect(words('WebSearch', 'Acme platform team')?.doing).toBe(
      'Searching the web for “Acme platform team”',
    );
    expect(words('WebSearch')?.did).toBe('Searched the web');
    expect(words('WebFetch', 'acme.com')?.did).toBe('Read acme.com');
    expect(words('Grep')?.doing).toBe('Looking through your workspace');
  });

  it('says Claude made its to-do list, but not each tick on it, or a question', () => {
    expect(words('TodoWrite', '7 steps')).toEqual({
      doing: 'Planning 7 steps',
      did: 'Planned 7 steps',
    });
    expect(words('TaskCreate')?.did).toBe('Planned the steps');
    // An update, as an item starts or ends, shows as "Step 3 of 7" in the strip instead.
    expect(words('TodoWrite')).toBeNull();
    expect(words('TaskUpdate')).toBeNull();
    expect(words('TaskList')).toBeNull();
    expect(words('AskUserQuestion')).toBeNull();
  });

  it('says Claude started a helper, with what it asked of it', () => {
    expect(words('Agent', 'Fact-check the resume')).toEqual({
      doing: 'Starting a helper for “Fact-check the resume”',
      did: 'Started a helper for “Fact-check the resume”',
    });
    // As Claude Code named the tool before.
    expect(words('Task')?.doing).toBe('Starting a helper');
  });

  it('says which of Factwright’s skills Claude reads, by what it’s how to do', () => {
    expect(words('Skill', 'factwright:focused-resume')).toEqual({
      doing: 'Reading how to tailor a resume',
      did: 'Read how to tailor a resume',
    });
    expect(words('Skill', 'analyze-job')?.doing).toBe('Reading how to analyze a job');
    expect(words('Skill', 'other:thing')?.did).toBe('Read the “other:thing” skill');
    expect(words('Skill')).toBeNull();
  });

  it('says what the tools that came later do', () => {
    expect(words('mcp__factwright__correct_fact')?.doing).toBe('Correcting a fact');
    expect(words('mcp__factwright__log_check')?.did).toBe('Logged the check');
  });
});

describe('stepKind', () => {
  const kind = (tool: string) => stepKind({ tool });

  it('draws each kind of step as its own picture', () => {
    expect(kind('Read')).toBe('reading');
    expect(kind('WebFetch')).toBe('reading');
    expect(kind('mcp__factwright__read_posting')).toBe('reading');
    expect(kind('Skill')).toBe('reading');
    expect(kind('WebSearch')).toBe('searching');
    expect(kind('Grep')).toBe('searching');
    expect(kind('mcp__factwright__find_job')).toBe('searching');
    expect(kind('Write')).toBe('writing');
    expect(kind('mcp__factwright__save_answer')).toBe('writing');
    expect(kind('mcp__factwright__save_fact')).toBe('checking');
    expect(kind('mcp__factwright__verify_fact')).toBe('checking');
    expect(kind('mcp__factwright__build_resume')).toBe('building');
    expect(kind('mcp__factwright__build_projects_page')).toBe('building');
    expect(kind('Agent')).toBe('helpers');
  });

  it('draws nothing of its own for what says nothing, such as the to-do list', () => {
    expect(kind('TodoWrite')).toBeNull();
    expect(kind('TaskUpdate')).toBeNull();
    expect(kind('mcp__factwright__a_tool_from_later')).toBeNull();
  });

  it('has a picture for every one of Factwright’s tools with words', () => {
    for (const tool of [
      'find_job',
      'search_focus',
      'job_details',
      'revision_findings',
      'requested_changes',
      'read_posting',
      'read_page',
      'build_resume',
      'build_cover_letter',
      'build_projects_page',
      'save_call_prep',
      'save_thank_you',
      'list_templates',
      'read_template',
      'save_template',
      'save_posting',
      'job_board',
      'hn_jobs',
      'about_you',
      'past_answers',
      'save_answer',
      'save_fact',
      'save_gap',
      'verify_fact',
      'correct_fact',
      'save_about_you',
      'save_work_history',
      'log_check',
    ]) {
      expect(words(`mcp__factwright__${tool}`), tool).not.toBeNull();
      expect(kind(`mcp__factwright__${tool}`), tool).not.toBeNull();
    }
  });
});

describe('todoWords', () => {
  const list = (...states: TodoState[]): TodoItem[] =>
    states.map((state, at) => ({ text: `Do ${at + 1}`, doing: `Doing ${at + 1}`, state }));

  it('says the step Claude is on, by its place in the list, in the words it says while on it', () => {
    const todos = list('completed', 'completed', 'in_progress', 'pending');
    expect(todoAt(todos)).toMatchObject({ at: 3, of: 4 });
    expect(todoWords(todos)).toBe('Step 3 of 4: Doing 3');
    expect(
      todoWords([{ text: 'Read it', doing: null, state: 'in_progress' }, ...list('pending')]),
    ).toBe('Step 1 of 2: Read it');
  });

  it('says the next step between two, in its own words', () => {
    expect(todoWords(list('completed', 'pending', 'pending'))).toBe('Step 2 of 3: Do 2');
  });

  it('says nothing of a list of one, or one that’s done', () => {
    expect(todoWords([])).toBeNull();
    expect(todoWords(list('in_progress'))).toBeNull();
    expect(todoWords(list('completed', 'completed'))).toBeNull();
  });
});

describe('helpersWords', () => {
  const helpers = (count: number, what: string | null = null): RunHelper[] =>
    Array.from({ length: count }, (_, at) => ({ id: `agent-${at}`, what }));

  it('says what the run’s helpers do, where its skill says, one and several', () => {
    expect(helpersWords(helpers(4), 'analyze-job')).toBe('4 helpers analyzing jobs');
    expect(helpersWords(helpers(1), 'analyze-job')).toBe('A helper is analyzing a job');
    expect(helpersWords(helpers(1), 'focused-resume')).toBe('A helper is checking the facts');
    expect(helpersWords(helpers(2), 'job-search')).toBe('2 helpers going through the jobs');
  });

  it('says what Claude asked of a helper alone, or else that they’re at work', () => {
    expect(helpersWords(helpers(1, 'Read the posting'), 'salary-check')).toBe(
      'A helper is on “Read the posting”',
    );
    expect(helpersWords(helpers(1), null)).toBe('A helper is at work');
    expect(helpersWords(helpers(3, 'Read'), 'salary-check')).toBe('3 helpers at work');
    expect(helpersWords([], 'analyze-job')).toBeNull();
  });

  it('draws a helper alone as checking facts where its skill’s helpers check them', () => {
    expect(helperKind('focused-resume')).toBe('checking');
    expect(helperKind('cover-letter')).toBe('checking');
    expect(helperKind('analyze-job')).toBeNull();
    expect(helperKind(null)).toBeNull();
  });
});
