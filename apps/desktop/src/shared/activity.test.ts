import { describe, expect, it } from 'vitest';
import { stepWords } from './activity.ts';

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

  it('says nothing of what isn’t worth showing, such as a to-do list or a question', () => {
    expect(words('TodoWrite')).toBeNull();
    expect(words('AskUserQuestion')).toBeNull();
    expect(words('Task')).toBeNull();
  });
});
