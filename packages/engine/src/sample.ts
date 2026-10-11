import type { Resume } from './schema.ts';

/** A made-up resume for tests. */
export function sampleResume(): Resume {
  return {
    layout: 'timeline',
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
