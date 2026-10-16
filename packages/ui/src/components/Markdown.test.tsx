import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, MarkdownLine } from './Markdown.tsx';

describe('Markdown', () => {
  it('shows headings, paragraphs and inline marks', () => {
    const { container } = render(
      <Markdown text={'# Staff Engineer\n\nBuild **tools** for *every* team.\nUse `Go`.'} />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Staff Engineer' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('tools');
    expect(container.querySelector('em')?.textContent).toBe('every');
    expect(container.querySelector('code')?.textContent).toBe('Go');
    expect(container.querySelector('p')?.innerHTML).toContain('<br>');
  });

  it('nests indented list items', () => {
    const { container } = render(
      <Markdown text={'- Work 33/40\n  - ✓ Build tooling\n  - ✗ Rust\n- Role 20/25'} />,
    );
    const top = container.querySelector('ul');
    expect(top?.children).toHaveLength(2);
    expect(top?.querySelector('li > ul')?.children).toHaveLength(2);
  });

  it('makes links that open outside the app, and only for web and email addresses', () => {
    render(
      <Markdown
        text={
          'See [the posting](https://acme.example/jobs/1), email [us](mailto:jobs@acme.example), or https://acme.example/team. Not [this](javascript:alert(1)).'
        }
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://acme.example/jobs/1',
      'mailto:jobs@acme.example',
      'https://acme.example/team',
    ]);
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('this', { selector: 'a' })).toBeNull();
  });

  // Each budget is many times what the text takes now, and a small part of what it took before,
  // so a slow computer passes and the old way can't.
  it('reads text full of unfinished links quickly', () => {
    const start = performance.now();
    // Uncapped, this took about 9 seconds: each "[" read the rest of the text as a link's address.
    render(<Markdown text={'[a](http://'.repeat(40_000)} />);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('reads text full of marks between unfinished links quickly', () => {
    const start = performance.now();
    // This took about half a minute, when each mark had every unfinished link read again.
    render(<Markdown text={'**a**[a](mailto:'.repeat(4000)} />);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('reads 100,000 characters made to slow it down in well under 100 ms', () => {
    const texts = [
      // Before, each "[" read up to 500 characters on, looking for its "]".
      '['.repeat(100_000),
      `${'['.repeat(50_000)}${']'.repeat(50_000)}`,
      '[a](http://'.repeat(9_091),
      '*'.repeat(100_000),
      // Emphasis left open.
      ' *a'.repeat(33_333),
      // A table's rule, and a list item with a line separator, were read again for each way to
      // split their spaces: about 11 seconds each.
      `|a\n${' '.repeat(100_000)}x`,
      `- ${' '.repeat(100_000)}x\u2028`,
    ];
    for (const text of texts) {
      // The fastest of three, so a busy test machine's pauses don't count.
      const times = [1, 2, 3].map(() => {
        const start = performance.now();
        render(<Markdown text={text} />).unmount();
        return performance.now() - start;
      });
      expect(Math.min(...times)).toBeLessThan(100);
    }
  });

  it('fills out short table rows, but not with millions of empty cells', () => {
    const { container } = render(<Markdown text={'| a | b | c |\n|---|---|---|\n| 1 |'} />);
    expect([...container.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      '1',
      '',
      '',
    ]);
    // 1,000 cells across, over 1,000 rows of "|", made a million cells. Rows are now filled out
    // with no more than 10,000 empty cells, or one for each character, so the rest stay short.
    const wide = render(<Markdown text={`|${'a|'.repeat(1000)}\n|--|\n${'|\n'.repeat(1000)}`} />);
    expect(wide.container.querySelectorAll('td')).toHaveLength(10 * 1000 + 990);
  });

  it('shows a heading or list item with a line separator in it', () => {
    // A heading like this one kept the view adding empty paragraphs until it ran out of memory.
    const { container } = render(<Markdown text={'# Staff\u2028Engineer\n- Build\u2028tooling'} />);
    expect(container.querySelector('h3')?.textContent).toBe('Staff\u2028Engineer');
    expect(container.querySelector('li')?.textContent).toBe('Build\u2028tooling');
  });

  it('never turns text into markup', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> **<b>hi</b>**'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('shows tables, quotes and code blocks', () => {
    const { container } = render(
      <Markdown
        text={
          '| Part | Points |\n|---|---|\n| Work | 33/40 |\n\n> A quote\n\n```\nconst x = 1;\n```'
        }
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Part' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '33/40' })).toBeTruthy();
    expect(container.querySelector('blockquote')?.textContent).toBe('A quote');
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 1;');
  });
});

describe('MarkdownLine', () => {
  it('shows inline marks without a paragraph', () => {
    const { container } = render(<MarkdownLine text="Email **jobs@acme.example**" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('jobs@acme.example');
  });
});
