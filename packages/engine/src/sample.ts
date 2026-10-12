import type { Resume } from './schema.ts';

/** A made-up resume for tests. */
export function sampleResume(): Resume {
  return {
    layout: 'classic',
    format: 'pdf',
    name: 'Alex Rivera',
    headline: 'Staff Platform Engineer',
    tagline: 'Platforms · Developer Tools · Reliability',
    contact: { email: 'alex@example.com', location: 'Remote, US' },
    summary: 'Builds **developer platforms** that teams trust.',
    impact_stats: [
      { value: '~40%', label: 'Faster deploys' },
      { value: '12', label: 'Services moved' },
    ],
    competencies: ['Platform design', 'Mentoring'],
    systems_heading: 'Key Systems Built at Tidewater',
    systems: [
      {
        name: 'Deploy pipeline',
        text: 'One-click releases for twelve services, with automatic rollback on failed checks.',
      },
    ],
    experience: [
      {
        title: 'Staff Engineer',
        company: 'Tidewater Analytics',
        company_note: 'Data tools',
        location: 'Remote',
        start: '03/2022',
        end: 'Present',
        intro: 'Leads the platform team.',
        bullet_groups: [
          {
            heading: 'Platform',
            bullets: [{ lead: 'Pipelines', text: 'Cut deploy time by **~40%**.' }],
          },
        ],
      },
    ],
    projects: [
      { name: 'Tidy', status: 'Live', url: 'tidy.example', text: 'A small CLI for tidy logs.' },
    ],
    skills: [{ category: 'Languages', items: ['TypeScript', 'Go'] }],
    extra_sections: [{ heading: 'Talks', items: ['Platform Days 2025'] }],
  };
}

/**
 * A made-up resume that fills about a page, for showing what each template looks like. It has a
 * little of everything a resume can hold.
 */
export function previewResume(): Resume {
  return {
    name: 'Jordan Avery',
    headline: 'Senior Product Manager',
    tagline: 'Marketplaces · Growth · Data-informed roadmaps',
    contact: {
      phone: '(555) 014-2387',
      email: 'jordan.avery@example.com',
      linkedin: 'linkedin.com/in/jordan-avery',
      location: 'Denver, CO',
    },
    summary:
      'Product manager with **eight years** in two-sided marketplaces. Turns messy customer problems into clear bets, ships with small teams, and measures what moved. Comfortable from discovery interviews to pricing experiments.',
    impact_stats: [
      { value: '~31%', label: 'Higher repeat bookings' },
      { value: '4', label: 'Products launched' },
      { value: '$2.4M', label: 'New yearly revenue' },
      { value: '12', label: 'People on the team' },
    ],
    competencies: [
      'Product strategy',
      'Customer discovery',
      'Pricing',
      'Experimentation',
      'Roadmaps',
      'Team leadership',
    ],
    systems_heading: 'Selected Work',
    systems: [
      {
        name: 'Repeat booking program',
        text: 'Designed rewards and reminders that lifted repeat bookings by about a third in a year.',
      },
      {
        name: 'Host pricing tool',
        text: 'Launched suggested pricing that hosts adopted on most new listings within a quarter.',
      },
    ],
    experience: [
      {
        title: 'Senior Product Manager',
        company: 'Northwind Stays',
        company_note: 'Vacation rentals',
        location: 'Denver, CO',
        start: '04/2021',
        end: 'Present',
        bullet_groups: [
          {
            heading: 'Growth',
            bullets: [
              {
                lead: 'Loyalty',
                text: 'Led the repeat booking program from research to launch, lifting repeat bookings by **~31%**.',
              },
              {
                text: 'Ran 40+ pricing and checkout experiments with data science, adding **$2.4M** in yearly revenue.',
              },
            ],
          },
          {
            heading: 'Team',
            bullets: [
              {
                text: 'Grew the guest team to 12 across engineering, design and research, and set its quarterly goals.',
              },
            ],
          },
        ],
      },
      {
        title: 'Product Manager',
        company: 'Bramble Market',
        company_note: 'Local food delivery',
        location: 'Remote',
        start: '06/2018',
        end: '03/2021',
        bullet_groups: [
          {
            bullets: [
              {
                text: 'Launched same-day delivery in three cities with two engineers and a designer.',
              },
              {
                text: 'Rebuilt seller onboarding, cutting the time to a first sale from 9 days to 3.',
              },
            ],
          },
        ],
      },
      {
        title: 'Business Analyst',
        company: 'Cedar & Pine Consulting',
        location: 'Chicago, IL',
        start: '07/2016',
        end: '05/2018',
        bullet_groups: [
          {
            bullets: [
              {
                text: 'Built the reporting retail clients used to plan inventory for 200+ stores.',
              },
            ],
          },
        ],
      },
    ],
    education: [
      {
        degree: 'B.S., Economics',
        school: 'University of Colorado Boulder',
        location: 'Boulder, CO',
        end: '2016',
      },
    ],
    skills: [
      { category: 'Product', items: ['Discovery', 'Roadmapping', 'A/B testing', 'Pricing'] },
      { category: 'Tools', items: ['SQL', 'Amplitude', 'Figma', 'Jira'] },
    ],
  };
}
