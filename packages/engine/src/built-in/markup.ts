/**
 * The page the built-in templates share: a header, then each part of the resume in a section
 * under its heading, in the order applicant systems expect. Each template styles it its own way.
 * The class names are the ones the fit check measures, so a template of the user's own that
 * starts from these keeps the check working.
 */
export const BODY = `
<div class="hdr">{{> header}}{{> contact}}</div>
{{> stats}}
<section><h2>{{titles.summary}}</h2><div class="blk"><div class="sum">{{summary}}</div></div></section>
{{#education_first}}{{> education}}{{/education_first}}
{{#competencies.length}}<section><h2>{{titles.competencies}}</h2><div class="blk"><ul class="comp">{{#competencies}}<li>{{.}}</li>{{/competencies}}</ul></div></section>{{/competencies.length}}
{{#systems.length}}<section><h2>{{titles.systems}}</h2><div class="blk"><div class="systems">{{#systems}}<div class="sys"><b>{{name}}</b><div>{{text}}</div></div>{{/systems}}</div></div></section>{{/systems.length}}
<section><h2>{{titles.experience}}</h2><div class="blk">{{#experience}}{{> job}}{{/experience}}</div></section>
{{#projects.length}}<section><h2>{{titles.projects}}</h2><div class="blk">{{#projects}}{{> project}}{{/projects}}</div></section>{{/projects.length}}
{{^education_first}}{{> education}}{{/education_first}}
{{#skills.length}}<section><h2>{{titles.skills}}</h2><div class="blk"><div class="skills">{{#skills}}<div class="s"><b>{{category}}:</b> {{items_line}}</div>{{/skills}}</div></div></section>{{/skills.length}}
{{#extra_sections}}<section><h2>{{heading}}</h2><div class="blk"><ul class="b">{{#items}}<li>{{.}}</li>{{/items}}</ul></div></section>{{/extra_sections}}
`;

/** The pieces BODY shows by name. */
export const PARTS = {
  header: `
  <div class="name">{{name}}</div>
  <div class="headline">{{headline}}</div>
  {{#tagline}}<div class="tagline">{{tagline}}</div>{{/tagline}}`,
  contact: '<div class="contact">{{#contact}}<span>{{text}}</span>{{/contact}}</div>',
  stats:
    '{{#stats.length}}<div class="stats" style="--n:{{stats.length}}">{{#stats}}<div class="stat"><b>{{value}}</b><span>{{label}}</span></div>{{/stats}}</div>{{/stats.length}}',
  education:
    '{{#education.length}}<section><h2>{{titles.education}}</h2><div class="blk">{{#education}}{{> school}}{{/education}}</div></section>{{/education.length}}',
  school: `<div class="edu">
    <div class="row"><div class="title">{{degree}}</div>{{#dates}}<div class="when">{{dates}}</div>{{/dates}}</div>
    <div class="row"><div class="co">{{school}}</div>{{#location}}<div class="co">{{location}}</div>{{/location}}</div>
    {{#note}}<div class="note">{{note}}</div>{{/note}}</div>`,
  job: `<div class="job">
    <div class="row"><div class="title">{{title}}</div><div class="when">{{dates}}</div></div>
    <div class="row"><div class="co">{{company_line}}</div><div class="co">{{location}}</div></div>
    {{> job-body}}</div>`,
  'job-body':
    '{{#intro}}<div class="intro">{{intro}}</div>{{/intro}}{{#groups}}{{#heading}}<div class="grp">{{heading}}</div>{{/heading}}<ul class="b">{{#bullets}}<li>{{#lead}}<span class="lead">{{lead}}:</span> {{/lead}}{{text}}</li>{{/bullets}}</ul>{{/groups}}',
  project:
    '<div class="proj"><span class="pn">{{name}}</span>{{#status}} <span class="ps">· {{status}}</span>{{/status}}{{#url}} <span class="ps">· {{url}}</span>{{/url}}<div>{{text}}</div></div>',
};
