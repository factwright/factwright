import { describe, expect, it } from 'vitest';
import { findTerm, findTerms, termOf } from './terms.ts';
import { VOCABULARY } from './vocabulary.ts';

const named = (name: string) => {
  const found = VOCABULARY.find((term) => term.name === name);
  if (!found) throw new Error(`No term ${name}`);
  return found;
};
const names = (text: string) => findTerms(text, VOCABULARY).map((hit) => hit.term.name);

describe('termOf', () => {
  it('keeps capitals for a short acronym, a form marked with =, and a one-letter language', () => {
    expect(termOf('SQL').forms[0]).toEqual({ text: 'SQL', exact: true, listed: false });
    expect(termOf('=Go|Golang').forms).toEqual([
      { text: 'Go', exact: true, listed: false },
      { text: 'Golang', exact: false, listed: false },
    ]);
    expect(termOf('~R').forms[0]).toEqual({ text: 'R', exact: true, listed: true });
    expect(termOf('Kubernetes').forms[0]?.exact).toBe(false);
  });
});

describe('finding terms', () => {
  it('finds a term by any of its names, in any case', () => {
    expect(findTerm('Built services on Postgres', named('PostgreSQL'))).toBe('Postgres');
    expect(findTerm('ran kubernetes clusters', named('Kubernetes'))).toBe('kubernetes');
    expect(findTerm('Deep work on k8s', named('Kubernetes'))).toBe('k8s');
  });

  it('finds only whole words', () => {
    expect(findTerm('JavaScript and TypeScript', named('Java'))).toBeNull();
    expect(findTerm('ASP.NET Core', named('.NET'))).toBeNull();
    expect(findTerm('ASP.NET Core', named('ASP.NET'))).toBe('ASP.NET');
  });

  it('finds names with marks in them', () => {
    expect(names('C++, C#, .NET, Node.js and CI/CD')).toEqual([
      'C++',
      'C#',
      '.NET',
      'Node.js',
      'CI/CD',
    ]);
    expect(findTerm('CI / CD pipelines', named('CI/CD'))).toBe('CI / CD');
  });

  it('matches words with a space or a hyphen between them, and "and" or "&"', () => {
    expect(findTerm('machine-learning models', named('Machine learning'))).toBe('machine-learning');
    expect(findTerm('Compensation & Benefits', named('Compensation and benefits'))).toBe(
      'Compensation & Benefits',
    );
    expect(
      findTerm('diversity, equity, and inclusion', named('Diversity equity and inclusion')),
    ).toBe('diversity, equity, and inclusion');
  });

  it('takes a phrase or an acronym in the plural, but not a name', () => {
    expect(findTerm('Data pipelines at scale', named('Data pipelines'))).toBe('Data pipelines');
    expect(findTerm('Set KPIs each quarter', named('KPIs'))).toBe('KPIs');
    expect(findTerm('Drew it on canvas', named('Canva'))).toBeNull();
  });

  it('keeps capitals for everyday words that are also tools', () => {
    expect(names('We go fast and keep things in excel shape')).toEqual([]);
    expect(names('Go, Rust and Swift')).toEqual(['Go', 'Rust', 'Swift']);
    expect(names('it matters')).toEqual([]);
    expect(names('IT support')).toEqual([]);
  });

  it('skips an everyday word that only starts a sentence', () => {
    expect(names('Excel at building relationships')).toEqual([]);
    expect(names('Go above and beyond for customers')).toEqual([]);
    expect(names('Advanced Excel, including pivot tables')).toEqual([
      'Microsoft Excel',
      'Pivot tables',
    ]);
  });

  it('finds a one-letter language only in a list', () => {
    expect(names('Python, R, and SQL')).toEqual(['Python', 'R', 'SQL']);
    expect(names('R or Python')).toEqual(['R', 'Python']);
    expect(names('R&D budgets')).toEqual([]);
    expect(names('a Series C company')).toEqual([]);
    expect(names('C-suite leaders')).toEqual([]);
  });

  it('keeps the longest where two overlap', () => {
    expect(names('React Native apps')).toEqual(['React Native']);
    expect(names('Google Cloud Platform')).toEqual(['Google Cloud Platform']);
  });

  it('finds every match, however often the same pattern was used before', () => {
    const term = named('SQL');
    expect(findTerm('a long text that mentions SQL near its end', term)).toBe('SQL');
    expect(findTerms('SQL first', [term]).map((hit) => hit.at)).toEqual([0]);
  });

  it('reads curly quotes, dashes and joined letters as plain ones', () => {
    expect(findTerm('eﬃcient front–end work', named('Front end'))).toBe('front-end');
  });
});
