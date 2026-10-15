import {
  type Check,
  type CheckId,
  type CheckStatus,
  type KeyTerm,
  SECTION_NAMES,
  type XRay,
} from '@factwright/xray';
import { CircleCheck, Info, Minus, Check as Tick, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './XRay.module.css';

const STATUS_ICON: Readonly<Record<CheckStatus, ReactNode>> = {
  fix: <TriangleAlert size={16} />,
  note: <Info size={16} />,
  pass: <CircleCheck size={16} />,
};

const STATUS_WORDS: Readonly<Record<CheckStatus, string>> = {
  fix: 'To fix',
  note: 'Worth knowing',
  pass: 'Passed',
};

/** A check with a problem: what it found, what it means, and where it is in the text. */
function Problem({
  check,
  showing,
  onShow,
}: {
  check: Check;
  showing: boolean;
  onShow: (id: CheckId) => void;
}) {
  return (
    <li className={styles.problemCheck}>
      <span className={styles[check.status]} aria-hidden="true">
        {STATUS_ICON[check.status]}
      </span>
      <div className={styles.checkBody}>
        <p className={styles.checkName}>{check.name}</p>
        <p className={styles.checkSummary}>{check.summary}</p>
        {check.detail && <p className={styles.checkDetail}>{check.detail}</p>}
        {check.examples && check.examples.length > 0 && (
          <ul className={styles.examples} aria-label="As the parser reads it">
            {check.examples.map((example) => (
              <li key={example}>
                <code>{example}</code>
              </li>
            ))}
          </ul>
        )}
        {check.lines.length > 0 && (
          <button
            type="button"
            className={styles.link}
            aria-pressed={showing}
            onClick={() => onShow(check.id)}
          >
            {showing ? 'Showing it in the text' : 'Show it in the text'}
          </button>
        )}
      </div>
    </li>
  );
}

/** Every check: problems first, each with what to do, then what's fine, in a line each. */
export function ChecksView({
  result,
  showing,
  onShow,
}: {
  result: XRay;
  showing: CheckId | null;
  onShow: (id: CheckId) => void;
}) {
  const groups = (['fix', 'note', 'pass'] as const)
    .map((status) => ({ status, checks: result.checks.filter((check) => check.status === status) }))
    .filter((group) => group.checks.length > 0);
  return (
    <div className={styles.groups}>
      {groups.map(({ status, checks }) => (
        <section key={status} aria-label={STATUS_WORDS[status]}>
          <h4 className={styles.groupTitle}>{STATUS_WORDS[status]}</h4>
          {status === 'pass' ? (
            <ul className={styles.passes}>
              {checks.map((check) => (
                <li key={check.id} className={styles.passCheck}>
                  <span className={styles.pass} aria-hidden="true">
                    <Tick size={14} strokeWidth={2.6} />
                  </span>
                  <span className={styles.passName}>{check.name}</span>
                  <span className={styles.passSummary}>{check.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className={styles.problems}>
              {checks.map((check) => (
                <Problem
                  key={check.id}
                  check={check}
                  showing={showing === check.id}
                  onShow={onShow}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** What to do about a term the fact bank has, and why: add it, or confirm it first. */
const ADVICE = {
  facts: {
    label: 'Add it',
    tone: styles.add,
    why: (where: string) => `Your fact bank backs it: ${where}.`,
  },
  unconfirmed: {
    label: 'Confirm it first',
    tone: styles.confirm,
    why: (where: string) =>
      `Only a claim you haven’t confirmed has it: ${where}. Confirm it in the Fact bank, then add it.`,
  },
} as const;

/** A missing term the fact bank has: what to do, why, and where the posting asks for it. */
function TermToAdd({ term }: { term: KeyTerm }) {
  const backing = term.backing;
  if (backing.kind !== 'facts' && backing.kind !== 'unconfirmed') return null;
  const advice = ADVICE[backing.kind];
  return (
    <li className={styles.term}>
      <div className={styles.termHead}>
        <span className={styles.termName}>{term.term}</span>
        <span className={`${styles.advice} ${advice.tone}`}>{advice.label}</span>
      </div>
      <p className={styles.termWhy}>{advice.why(backing.where)}</p>
      <p className={styles.termContext}>From the posting: “{term.context}”</p>
    </li>
  );
}

/**
 * A group of the posting's terms: missing ones the fact bank has, with what to do; the ones the
 * resume has; and real gaps, which stay off.
 */
function TermGroup({
  title,
  terms,
  explain,
}: {
  title: string;
  terms: readonly KeyTerm[];
  /** Whether to say what a real gap means: once, under the first group that has one. */
  explain: boolean;
}) {
  if (terms.length === 0) return null;
  const found = terms.filter((term) => term.found);
  const toAdd = terms
    .filter(
      (term) =>
        !term.found && (term.backing.kind === 'facts' || term.backing.kind === 'unconfirmed'),
    )
    .sort((a, b) => (a.backing.kind === 'facts' ? 0 : 1) - (b.backing.kind === 'facts' ? 0 : 1));
  const gaps = terms.filter(
    (term) => !term.found && (term.backing.kind === 'none' || term.backing.kind === 'said-no'),
  );
  const otherNames = found.filter((term) => term.otherName);
  return (
    <section aria-label={title}>
      <h4 className={styles.groupTitle}>
        {title}
        <span className={styles.groupCount}>
          {found.length} of {terms.length} on your resume
        </span>
      </h4>
      <div className={styles.termGroup}>
        {toAdd.length > 0 && (
          <ul className={styles.terms} aria-label="To add">
            {toAdd.map((term) => (
              <TermToAdd key={term.term} term={term} />
            ))}
          </ul>
        )}
        {found.length > 0 && (
          <ul className={styles.chips} aria-label="On your resume">
            {found.map((term) => (
              <li
                key={term.term}
                className={styles.foundTerm}
                title={`From the posting: “${term.context}”`}
              >
                <Tick size={12} strokeWidth={2.8} aria-hidden="true" />
                {term.term}
                {term.otherName && <span className={styles.foundAs}>as “{term.found}”</span>}
              </li>
            ))}
          </ul>
        )}
        {otherNames.length > 0 && (
          <p className={styles.footnote}>
            Some systems match only the posting’s own words. Where it’s true, use them too:{' '}
            {otherNames.map((term) => `“${term.term}”`).join(', ')}.
          </p>
        )}
        {gaps.length > 0 && (
          <div>
            <ul className={styles.chips} aria-label="Real gaps">
              {gaps.map((term) => (
                <li
                  key={term.term}
                  className={styles.gapTerm}
                  title={`From the posting: “${term.context}”`}
                >
                  <Minus size={12} strokeWidth={2.8} aria-hidden="true" />
                  {term.term}
                  {term.backing.kind === 'said-no' && (
                    <span className={styles.foundAs}>you said you don’t have it</span>
                  )}
                </li>
              ))}
            </ul>
            {explain && (
              <p className={styles.footnote}>
                Real gaps stay off: nothing in your fact bank backs them. If you do have one, add it
                to your Fact bank first.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Whether any of the terms is a real gap, or one the user said they don't have. */
const hasGap = (terms: readonly KeyTerm[]) =>
  terms.some(
    (term) => !term.found && (term.backing.kind === 'none' || term.backing.kind === 'said-no'),
  );

/** The posting's key terms, found or missing, and for each one missing, what's honest to do. */
export function KeywordsView({ result, hasPosting }: { result: XRay; hasPosting: boolean }) {
  const keywords = result.keywords;
  if (!keywords) {
    return (
      <p className={styles.empty}>
        {hasPosting
          ? 'This job has no posting saved, so there are no terms to check.'
          : 'Keywords are checked against a job’s posting. Open the X-ray from a resume in a job’s Files to see them.'}
      </p>
    );
  }
  if (keywords.terms.length === 0) {
    return <p className={styles.empty}>The posting names no skills or tools the X-ray knows.</p>;
  }
  const must = keywords.terms.filter((term) => term.need === 'must');
  const nice = keywords.terms.filter((term) => term.need === 'nice');
  return (
    <div className={styles.groups}>
      <p className={styles.honest}>
        Add a term only where your fact bank backs it. A real gap stays off: every line of a resume
        comes from a fact you’ve confirmed.
      </p>
      <TermGroup
        title={keywords.sectioned ? 'Must-haves' : 'Key terms'}
        terms={must}
        explain={hasGap(must)}
      />
      <TermGroup title="Nice to have" terms={nice} explain={!hasGap(must) && hasGap(nice)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd className={value ? undefined : styles.missing}>{value ?? 'Not found'}</dd>
    </div>
  );
}

/** What a system fills in from the resume, as an application form would show it. */
export function FieldsView({ result }: { result: XRay }) {
  const { fields, sections } = result;
  return (
    <div className={styles.groups}>
      <section aria-label="Contact">
        <h4 className={styles.groupTitle}>Contact</h4>
        <dl className={styles.rows}>
          <Row label="Name" value={fields.name} />
          <Row label="Email" value={fields.email} />
          <Row label="Phone" value={fields.phone} />
          <Row label="City" value={fields.location} />
          <Row label="Links" value={fields.links.length > 0 ? fields.links.join(', ') : null} />
        </dl>
      </section>
      <section aria-label="Jobs">
        <h4 className={styles.groupTitle}>
          Jobs<span className={styles.groupCount}>{fields.jobs.length}</span>
        </h4>
        {fields.jobs.length === 0 ? (
          <p className={styles.empty}>None found.</p>
        ) : (
          <ul className={styles.entries}>
            {fields.jobs.map((job) => (
              <li key={`${job.line}-${job.dates.at}`} className={styles.entry}>
                <span className={job.title ? styles.entryTitle : styles.missing}>
                  {job.title ?? 'No title found'}
                </span>
                <span className={styles.entryMeta}>
                  {[job.company ?? 'No company found', job.dates.text, job.location]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {fields.education.length > 0 && (
        <section aria-label="Education">
          <h4 className={styles.groupTitle}>Education</h4>
          <ul className={styles.entries}>
            {fields.education.map((school) => (
              <li key={school.line} className={styles.entry}>
                <span className={styles.entryTitle}>{school.degree ?? school.school}</span>
                <span className={styles.entryMeta}>
                  {[school.degree ? school.school : null, school.dates].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Skills">
        <h4 className={styles.groupTitle}>
          Skills<span className={styles.groupCount}>{fields.skills.length}</span>
        </h4>
        {fields.skills.length === 0 ? (
          <p className={styles.empty}>None found under a skills heading.</p>
        ) : (
          <ul className={styles.skills}>
            {fields.skills.map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Sections it recognizes">
        <h4 className={styles.groupTitle}>Sections it recognizes</h4>
        <ul className={styles.entries}>
          {sections.map((section) => (
            <li key={section.line} className={styles.sectionRow}>
              <span className={styles.sectionTitle}>{section.title}</span>
              <span className={section.kind ? styles.sectionKind : styles.sectionUnknown}>
                {section.kind
                  ? SECTION_NAMES[section.kind]
                  : 'Not a heading systems know, so what’s under it may be filed with the part before'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
