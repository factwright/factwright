import type { Layout, Resume } from '../schema.ts';

/** The heading over the systems cards, unless the resume names its own. */
export const DEFAULT_SYSTEMS_HEADING = 'Key Systems';

/** The heading over the projects, unless the resume names its own. */
export const DEFAULT_PROJECTS_HEADING = 'Independent Projects';

/** What a layout calls its sections. The PDF and the Word file use the same words. */
export interface SectionTitles {
  summary: string;
  competencies: string;
  experience: string;
  education: string;
  skills: string;
}

const TITLES: Record<Layout, SectionTitles> = {
  timeline: {
    summary: 'Summary',
    competencies: 'Core Competencies',
    experience: 'Experience',
    education: 'Education',
    skills: 'Technologies',
  },
  executive: {
    summary: 'Executive Summary',
    competencies: 'Core Competencies',
    experience: 'Professional Experience',
    education: 'Education',
    skills: 'Technical Skills',
  },
  modern: {
    summary: 'Profile',
    competencies: 'Expertise',
    experience: 'Experience',
    education: 'Education',
    skills: 'Technology',
  },
  classic: {
    summary: 'Summary',
    competencies: 'Areas of Expertise',
    experience: 'Professional Experience',
    education: 'Education',
    skills: 'Skills',
  },
  elegant: {
    summary: 'Profile',
    competencies: 'Expertise',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
  },
  compact: {
    summary: 'Summary',
    competencies: 'Strengths',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
  },
  minimal: {
    summary: 'Summary',
    competencies: 'Strengths',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
  },
  banner: {
    summary: 'Summary',
    competencies: 'Strengths',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
  },
};

/** A layout's section titles, with the headings the resume names itself. */
export function sectionTitles(
  layout: Layout,
  resume: Resume,
): SectionTitles & { systems: string; projects: string } {
  return {
    ...TITLES[layout],
    skills: resume.skills_heading || TITLES[layout].skills,
    systems: resume.systems_heading || DEFAULT_SYSTEMS_HEADING,
    projects: resume.projects_heading || DEFAULT_PROJECTS_HEADING,
  };
}
