import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT } from '../shared/effort.ts';
import { DEFAULT_MODELS } from '../shared/models.ts';
import { levelName, summarize, taskLevels } from './levels.ts';

describe('the levels Claude runs at', () => {
  it('on Max: Opus at Extra high, with job searches at High', () => {
    const { most, others } = summarize(taskLevels(DEFAULT_MODELS, DEFAULT_EFFORT, 'best'));
    expect(levelName(most)).toBe('Opus · Extra high');
    expect(others).toBe('Job searches at High');
  });

  it('with Pro’s levels: Opus at High, and lighter for the checks and searches', () => {
    const each = taskLevels(DEFAULT_MODELS, DEFAULT_EFFORT, 'pro');
    expect(each['fit-check']).toEqual({ model: 'sonnet', effort: 'high' });
    expect(each['salary-check']).toEqual({ model: 'sonnet', effort: 'medium' });
    const { most, others } = summarize(each);
    expect(levelName(most)).toBe('Opus · High');
    expect(others).toBe('Lighter for 4 tasks');
  });

  it('follows the user’s own choices over the plan’s', () => {
    const one = summarize(
      taskLevels({ main: 'sonnet', tasks: {} }, { main: 'high', tasks: {} }, 'pro'),
    );
    expect(levelName(one.most)).toBe('Sonnet · High');
    expect(one.others).toBe('For every task');
    const resume = summarize(
      taskLevels(
        { main: 'sonnet', tasks: { 'focused-resume': 'opus' } },
        { main: 'high', tasks: { 'focused-resume': 'max' } },
        'best',
      ),
    );
    expect(resume.others).toBe('Tailored resumes on Opus at Max');
  });

  it('says when the tasks that differ are more careful, or mixed', () => {
    const careful = summarize(
      taskLevels(
        { main: 'sonnet', tasks: {} },
        { main: 'high', tasks: { 'fit-check': 'max', 'focused-resume': 'xhigh' } },
        'best',
      ),
    );
    expect(careful.others).toBe('More careful for 2 tasks');
    const mixed = summarize(
      taskLevels(
        { main: 'sonnet', tasks: { 'fit-check': 'haiku' } },
        { main: 'high', tasks: { 'focused-resume': 'xhigh' } },
        'best',
      ),
    );
    expect(mixed.others).toBe('Different for 2 tasks');
  });

  it('counts what the writing runs at as most, in a tie', () => {
    const { most, others } = summarize(
      taskLevels(
        {
          main: 'haiku',
          tasks: {
            'fit-check': 'sonnet',
            'salary-check': 'sonnet',
            'who-to-message': 'sonnet',
            'focused-resume': 'opus',
            'projects-page': 'opus',
            'interview-prep': 'opus',
            'answer-questions': 'opus',
            ask: 'opus',
            'work-history': 'sonnet',
          },
        },
        { main: 'low', tasks: {} },
        'best',
      ),
    );
    // Five each on Opus, with tailored resumes, and on Haiku, and four on Sonnet.
    expect(levelName(most)).toBe('Opus · Low');
    expect(others).toBe('Lighter for 9 tasks');
  });
});
