import { describe, expect, it } from 'vitest';
import { savedTitles, titlesIn } from './titles.ts';

describe('titlesIn', () => {
  it.each([
    ['Product Designer', ['Product Designer']],
    // One title, with what it's about after the comma.
    ['Director, Sales', ['Director, Sales']],
    ['VP, Marketing', ['VP, Marketing']],
    ['Vice President, Engineering', ['Vice President, Engineering']],
    ['Head, Growth', ['Head, Growth']],
    ['Manager, Customer Success', ['Manager, Customer Success']],
    ['Manager, Customer Support', ['Manager, Customer Support']],
    ['Senior Manager, Strategy & Operations', ['Senior Manager, Strategy & Operations']],
    ['Software Engineer, Backend', ['Software Engineer, Backend']],
    ['Staff Software Engineer, Developer Tools', ['Staff Software Engineer, Developer Tools']],
    ['Product Manager, Payments', ['Product Manager, Payments']],
    ['Registered Nurse, ICU', ['Registered Nurse, ICU']],
    ['Data Scientist, Lead', ['Data Scientist, Lead']],
    ['Director, Sales Engineers', ['Director, Sales Engineers']],
    ['Director, Sales, Americas', ['Director, Sales, Americas']],
    [' Director ,  Sales ', ['Director, Sales']],
    ['Director,Sales', ['Director, Sales']],
    // Each names a job of its own.
    ['Product Manager, Program Manager', ['Product Manager', 'Program Manager']],
    ['Software Engineer, Backend Developer', ['Software Engineer', 'Backend Developer']],
    ['Accountant, Controller', ['Accountant', 'Controller']],
    ['Nurse, Charge Nurse', ['Nurse', 'Charge Nurse']],
    ['Electrician, Plumber', ['Electrician', 'Plumber']],
    ['Project Manager, Scrum Master', ['Project Manager', 'Scrum Master']],
    ['Scrum Master, Product Owner', ['Scrum Master', 'Product Owner']],
    ['Cashier, Sales Associate', ['Cashier', 'Sales Associate']],
    ['Manager, Director', ['Manager', 'Director']],
    ['Director, VP', ['Director', 'VP']],
    ['PM, TPM', ['PM', 'TPM']],
    ['Manager, (PM)', ['Manager', '(PM)']],
    ['Product Manager, Program Manager.', ['Product Manager', 'Program Manager.']],
    // Both at once.
    ['Director, Sales, Program Manager, Growth', ['Director, Sales', 'Program Manager, Growth']],
    // A new line always starts another.
    ['Director, Sales\nHead, Growth', ['Director, Sales', 'Head, Growth']],
    ['Sales\nMarketing', ['Sales', 'Marketing']],
    // What it doesn't know stays together, and Enter after each keeps them apart.
    ['Sales, Marketing', ['Sales, Marketing']],
    [',, Director,', ['Director']],
    ['', []],
  ])('reads %j as %j', (text, titles) => {
    expect(titlesIn(text)).toEqual(titles);
  });
});

describe('savedTitles', () => {
  it.each([
    // A comma used to split them.
    [['Director', 'Sales'], ['Director, Sales']],
    [
      ['VP', 'Marketing', 'Product Manager'],
      ['VP, Marketing', 'Product Manager'],
    ],
    [['Senior Manager', 'Customer Success'], ['Senior Manager, Customer Success']],
    [['Vice President', 'Engineering'], ['Vice President, Engineering']],
    [['Head', 'Growth'], ['Head, Growth']],
    [['Manager', 'Operations'], ['Manager, Operations']],
    [
      ['Director', 'Sales', 'Director', 'Marketing'],
      ['Director, Sales', 'Director, Marketing'],
    ],
    // What can stand alone, each told on its own.
    [
      ['Director', 'Program Manager'],
      ['Director', 'Program Manager'],
    ],
    [
      ['Director', 'VP'],
      ['Director', 'VP'],
    ],
    [
      ['Director', 'Head'],
      ['Director', 'Head'],
    ],
    [
      ['Manager', 'Director'],
      ['Manager', 'Director'],
    ],
    [
      ['Program Manager', 'Payments'],
      ['Program Manager', 'Payments'],
    ],
    [
      ['Software Engineer', 'Backend'],
      ['Software Engineer', 'Backend'],
    ],
    [
      ['Sales', 'Marketing'],
      ['Sales', 'Marketing'],
    ],
    [['Director'], ['Director']],
    [['Director, Sales'], ['Director, Sales']],
    [[], []],
  ])('reads %j as %j', (titles, read) => {
    expect(savedTitles(titles)).toEqual(read);
  });
});
