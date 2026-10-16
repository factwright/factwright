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
