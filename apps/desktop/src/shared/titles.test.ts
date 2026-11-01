import { describe, expect, it } from 'vitest';
import { savedTitles, titlesIn } from './titles.ts';

describe('titlesIn', () => {
  it.each([
    'Product Designer',
    // How senior, then the work.
    'Director, Sales',
    'VP, Marketing',
    'Vice President, Engineering',
    'Head, Growth',
    'Lead, Data Science',
    'Manager, Customer Success',
    'Manager, Customer Support',
    'Sr. Manager, Finance',
    'Senior Manager, Strategy & Operations',
    'Associate Director, Clinical Operations',
    'Director, Sales Engineers',
    'Director, Sales, Americas',
    // A job, then which one.
    'Software Engineer, Backend',
    'Staff Software Engineer, Developer Tools',
    'Product Manager, Payments',
    'Program Manager, PMO',
    'Registered Nurse, ICU',
    'Nurse, Home Health',
    'Teacher, Special Education',
    'Teacher, Math',
    'Teacher, Grade 3',
    'Technician, Automotive',
    'Welder, MIG',
    'Data Scientist, Lead',
  ])('keeps %j as one title', (title) => {
    expect(titlesIn(title)).toEqual([title]);
  });

  it.each([
    [' Director ,  Sales ', ['Director, Sales']],
    ['Director,Sales', ['Director, Sales']],
    ['Product Manager, Program Manager', ['Product Manager', 'Program Manager']],
    ['Software Engineer, Backend Developer', ['Software Engineer', 'Backend Developer']],
    ['Accountant, Controller', ['Accountant', 'Controller']],
    ['Project Manager, Scrum Master', ['Project Manager', 'Scrum Master']],
    ['Scrum Master, Product Owner', ['Scrum Master', 'Product Owner']],
    ['Graphic Designer, Illustrator', ['Graphic Designer', 'Illustrator']],
    ['Case Manager, Social Worker', ['Case Manager', 'Social Worker']],
    // Health.
    ['Nurse, Charge Nurse', ['Nurse', 'Charge Nurse']],
    ['Registered Nurse, Nurse Practitioner', ['Registered Nurse', 'Nurse Practitioner']],
    ['CNA, Caregiver', ['CNA', 'Caregiver']],
    [
      'Nurse Practitioner (NP), Physician Assistant (PA)',
      ['Nurse Practitioner (NP)', 'Physician Assistant (PA)'],
    ],
    ['Medical Assistant, Phlebotomist', ['Medical Assistant', 'Phlebotomist']],
    [
      'Charge Nurse, Nurse Manager, Director of Nursing',
      ['Charge Nurse', 'Nurse Manager', 'Director of Nursing'],
    ],
    // Schools.
    ['Teacher, Principal', ['Teacher', 'Principal']],
    ['Teacher, Paraprofessional', ['Teacher', 'Paraprofessional']],
    ['Teacher, Dean of Students', ['Teacher', 'Dean of Students']],
    ['Teacher, Professor of History', ['Teacher', 'Professor of History']],
    ['Substitute Teacher, Teacher’s Aide', ['Substitute Teacher', 'Teacher’s Aide']],
    ['Assistant Principal, Principal', ['Assistant Principal', 'Principal']],
    // Trades and logistics.
    ['Electrician, Plumber', ['Electrician', 'Plumber']],
    ['Truck Driver, Dispatcher', ['Truck Driver', 'Dispatcher']],
    ['HVAC Tech, HVAC Installer', ['HVAC Tech', 'HVAC Installer']],
    ['Forklift Operator, Warehouse Worker', ['Forklift Operator', 'Warehouse Worker']],
    ['Security Officer, Security Guard', ['Security Officer', 'Security Guard']],
    // Stores and restaurants.
    ['Cashier, Sales Associate', ['Cashier', 'Sales Associate']],
    ['Bartender, Server', ['Bartender', 'Server']],
    ['Server, Host', ['Server', 'Host']],
    [
      'Store Manager, Assistant Manager, Shift Lead',
      ['Store Manager', 'Assistant Manager', 'Shift Lead'],
    ],
    // Levels, and titles that hold one.
    ['Manager, Director', ['Manager', 'Director']],
    ['Director, VP', ['Director', 'VP']],
    ['Director, Head', ['Director', 'Head']],
    ['VP of Sales, Director of Sales', ['VP of Sales', 'Director of Sales']],
    ['Executive Assistant, Chief of Staff', ['Executive Assistant', 'Chief of Staff']],
    ['CTO, VP Engineering', ['CTO', 'VP Engineering']],
    // A number says how senior, and what's before it is the job.
    ['Analyst I, Analyst II', ['Analyst I', 'Analyst II']],
    ['Office Assistant II, Clerk III', ['Office Assistant II', 'Clerk III']],
    ['Software Engineer 2, Software Engineer 3', ['Software Engineer 2', 'Software Engineer 3']],
    // Short names.
    ['PM, TPM', ['PM', 'TPM']],
    ['SDR, BDR', ['SDR', 'BDR']],
    ['Manager, (PM)', ['Manager', '(PM)']],
    ['Product Manager, Program Manager.', ['Product Manager', 'Program Manager.']],
    // Neither says it's a job, so they're two.
    ['Sales, Marketing', ['Sales', 'Marketing']],
    ['Customer Service, Sales', ['Customer Service', 'Sales']],
    ['Retail, Customer Service, Warehouse', ['Retail', 'Customer Service', 'Warehouse']],
    // One of each, in a row.
    ['Director, Sales, Program Manager, Growth', ['Director, Sales', 'Program Manager, Growth']],
    // A new line always starts another.
    ['Director, Sales\nHead, Growth', ['Director, Sales', 'Head, Growth']],
    ['Software Engineer\nBackend', ['Software Engineer', 'Backend']],
    [',, Director,', ['Director']],
    ['', []],
  ])('reads %j as %j', (text, titles) => {
    expect(titlesIn(text)).toEqual(titles);
  });

  it('keeps apart what it takes for a job, as they’ve always been, and one title can drop its comma', () => {
    expect(titlesIn('Program Manager, Data Center')).toEqual(['Program Manager', 'Data Center']);
    expect(titlesIn('SVP, General Counsel')).toEqual(['SVP', 'General Counsel']);
    expect(titlesIn('Data Center Program Manager')).toEqual(['Data Center Program Manager']);
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
    // Told on their own, each can stand alone.
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
      ['Director', 'Head of Sales'],
      ['Director', 'Head of Sales'],
    ],
    [
      ['VP', 'Director of Marketing'],
      ['VP', 'Director of Marketing'],
    ],
    [
      ['Manager', 'Shift Lead'],
      ['Manager', 'Shift Lead'],
    ],
    [
      ['Manager', 'Server', 'Host'],
      ['Manager', 'Server', 'Host'],
    ],
    [
      ['Manager', 'Social Worker'],
      ['Manager', 'Social Worker'],
    ],
    [
      ['Lead', 'Warehouse Worker'],
      ['Lead', 'Warehouse Worker'],
    ],
    // These are jobs, not only levels.
    [
      ['Principal', 'Dean of Students'],
      ['Principal', 'Dean of Students'],
    ],
    [
      ['Principal', 'Curriculum'],
      ['Principal', 'Curriculum'],
    ],
    [
      ['Intern', 'Co-op'],
      ['Intern', 'Co-op'],
    ],
    [
      ['Internship', 'Apprenticeship'],
      ['Internship', 'Apprenticeship'],
    ],
    [
      ['Staff', 'Training'],
      ['Staff', 'Training'],
    ],
    // It can't tell, so they stay as they are.
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
