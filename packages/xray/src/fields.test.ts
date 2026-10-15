import { describe, expect, it } from 'vitest';
import { piecesOf, readFields } from './fields.ts';
import type { Line } from './read.ts';
import { findSections } from './sections.ts';
import { pdfLine, wordLine } from './testing.ts';

const heading = (text: string) => wordLine(text, { look: 'heading', size: 12 });
const fieldsOf = (lines: Line[]) => readFields(lines, findSections(lines));

describe('contact details', () => {
  it('reads the name from the top, and the details by their patterns', () => {
    const fields = fieldsOf([
      wordLine('Alex Rivera'),
      wordLine('alex.rivera@example.com | +1 (555) 014-2387 | Austin, Texas | github.com/alexr'),
      heading('Summary'),
      heading('Experience'),
    ]);
    expect(fields).toMatchObject({
      name: 'Alex Rivera',
      nameLine: 0,
      email: 'alex.rivera@example.com',
      phone: '+1 (555) 014-2387',
      location: 'Austin, Texas',
      links: ['github.com/alexr'],
    });
  });

  it('finds the name below a line that isn’t one, and says which line it’s on', () => {
    const fields = fieldsOf([
      wordLine('RESUME'),
      wordLine('María de la Cruz'),
      heading('Experience'),
    ]);
    expect(fields.name).toBe('María de la Cruz');
    expect(fields.nameLine).toBe(1);
  });

  it('takes remote work for a place', () => {
    expect(fieldsOf([wordLine('Sam Lee'), wordLine('sam@example.com · Remote, US')]).location).toBe(
      'Remote, US',
    );
  });

  it('isn’t fooled by spans of years or a title with a comma', () => {
    const fields = fieldsOf([
      wordLine('Sam Lee'),
      wordLine('Director, Product · 2019 - 2021 2022'),
    ]);
    expect(fields.phone).toBeNull();
    expect(fields.location).toBeNull();
  });
});

describe('jobs', () => {
  it('reads a title with its dates, then the company and place below', () => {
    const fields = fieldsOf([
      heading('Experience'),
      wordLine('Staff Engineer\t03/2022 – Present'),
      wordLine('Tidewater Analytics — Data tools\tRemote'),
      wordLine('Cut deploy time by 40%.'),
    ]);
    expect(fields.jobs).toEqual([
      expect.objectContaining({
        title: 'Staff Engineer',
        company: 'Tidewater Analytics',
        location: 'Remote',
      }),
    ]);
  });

  it('reads a company and place with the dates, then the title below', () => {
    const fields = fieldsOf([
      heading('Work History'),
      wordLine('Acme Corp | San Francisco, CA | Jan 2019 – Mar 2021'),
      wordLine('Senior Designer'),
    ]);
    expect(fields.jobs[0]).toMatchObject({
      title: 'Senior Designer',
      company: 'Acme Corp',
      location: 'San Francisco, CA',
    });
  });

  it('reads a date rail: the dates and place, then the title and company', () => {
    const fields = fieldsOf([
      heading('Experience'),
      wordLine('04/2021 – Present'),
      wordLine('Denver, CO'),
      wordLine('Senior Product Manager'),
      wordLine('Northwind Stays — Vacation rentals'),
      wordLine('GROWTH'),
      wordLine('Led the repeat booking program from research to launch.'),
    ]);
    expect(fields.jobs[0]).toMatchObject({
      title: 'Senior Product Manager',
      company: 'Northwind Stays',
      location: 'Denver, CO',
    });
  });

  it('reads only the experience sections for jobs', () => {
    const fields = fieldsOf([heading('Education'), wordLine('B.A., History 2010 – 2014')]);
    expect(fields.jobs).toEqual([]);
  });
});

describe('education and skills', () => {
  it('reads a date before its school, as a date rail has it', () => {
    const fields = fieldsOf([
      heading('Education'),
      wordLine('2016'),
      wordLine('B.S., Economics'),
      wordLine('University of Colorado Boulder'),
    ]);
    expect(fields.education[0]).toMatchObject({ degree: 'B.S., Economics', dates: '2016' });
  });

  it('reads a degree and school on separate lines as one', () => {
    const fields = fieldsOf([
      heading('Education'),
      wordLine('MBA\t2020'),
      wordLine('Kellogg School of Management'),
      wordLine('B.S. in Nursing, 2014'),
      wordLine('University of Michigan'),
    ]);
    expect(fields.education.map(({ degree, school, dates }) => [degree, school, dates])).toEqual([
      ['MBA', 'Kellogg School of Management', '2020'],
      ['B.S. in Nursing', 'University of Michigan', '2014'],
    ]);
  });

  it('splits skills at their marks, without category names, and joins a list wrapped onto the next line', () => {
    const fields = fieldsOf([
      heading('Skills'),
      wordLine('Languages: Python, Go; TypeScript'),
      wordLine('Tools: Docker · Kubernetes · A/B'),
      wordLine('testing | Terraform'),
    ]);
    expect(fields.skills).toEqual([
      'Python',
      'Go',
      'TypeScript',
      'Docker',
      'Kubernetes',
      'A/B testing',
      'Terraform',
    ]);
  });
});

describe('piecesOf', () => {
  it('splits a PDF line where there’s a wide gap', () => {
    const line: Line = {
      ...pdfLine('Staff Engineer', 40, 700),
      text: 'Staff Engineer 03/2022 – Present',
      runs: [
        { text: 'Staff Engineer', x: 40, y: 700, width: 70, size: 10, font: 'Bold' },
        { text: ' ', x: 110, y: 700, width: 380, size: 10, font: 'Bold' },
        { text: '03/2022 – Present', x: 490, y: 700, width: 80, size: 10, font: 'Body' },
      ],
    };
    expect(piecesOf(line)).toEqual(['Staff Engineer', '03/2022 – Present']);
  });

  it('splits a Word line at its tabs', () => {
    expect(piecesOf(wordLine('Staff Engineer\t03/2022 – Present'))).toEqual([
      'Staff Engineer',
      '03/2022 – Present',
    ]);
  });
});
