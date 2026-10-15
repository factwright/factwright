import {
  type Backing,
  type Check,
  type CheckId,
  type CheckStatus,
  type KeyTerm,
  SECTION_NAMES,
  type XRay,
} from '@factwright/xray';
import { CircleCheck, Info, Minus, Check as Tick, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import styles from './XRay.module.css';

/** A part of the report under its heading, which names it for screen readers. */
function Group({
  title,
  count,
  children,
}: {
  title: string;
  /** A count after the heading, such as how many jobs it found. */
  count?: number | string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h4 className={styles.groupTitle}>
        <span id={id}>{title}</span>
        {count !== undefined && (
          <>
            {' '}
            <span className={styles.groupCount}>{count}</span>
          </>
        )}
      </h4>
      {children}
    </section>
  );
}

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
        <Group key={status} title={STATUS_WORDS[status]}>
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
        </Group>
      ))}
    </div>
  );
}

/** A missing term's backing when the fact bank has it, to add now or once it's checked. */
type ToAdd = Extract<Backing, { kind: 'facts' | 'unread' | 'to-check' | 'doubted' | 'dont-claim' }>;

const TO_ADD: ReadonlySet<Backing['kind']> = new Set([
  'facts',
  'unread',
  'to-check',
  'doubted',
  'dont-claim',
]);

const isToAdd = (backing: Backing): backing is ToAdd => TO_ADD.has(backing.kind);

/** What to do about a term the fact bank has, and why: add it, or check it first. */
function adviceOf(backing: ToAdd): { label: string; tone: string | undefined; why: string } {
  const check = { label: 'Check it first', tone: styles.confirm };
  switch (backing.kind) {
    case 'facts':
      return {
        label: 'Add it',
        tone: styles.add,
        why: `Your fact bank backs it: ${backing.where}.`,
      };
    case 'unread':
      return {
        ...check,
        why: `Your fact bank backs it: ${backing.where}. Some of its files couldn’t be read, so check none of them says otherwise.`,
      };
    case 'to-check':
      return {
        ...check,
        why: `Only a claim you haven’t checked yet has it: ${backing.where}. Check it in the Fact bank, then add it.`,
      };
    case 'doubted':
      return {
        ...check,
        why: `Your fact bank says it needs confirming: “${backing.where}”. Confirm it in the Fact bank first.`,
      };
    case 'dont-claim':
      return {
        ...check,
        why: `${backing.where} says: “${backing.said}”. Add it only as that allows.`,
      };
  }
}

/** Whether a missing term is one the fact bank has, to add now or once it's checked. */
const toAdd = (term: KeyTerm) => !term.found && isToAdd(term.backing);

/** Whether a missing term is a real gap, or one the user said they don't have. */
const isGap = (term: KeyTerm) =>
  !term.found && (term.backing.kind === 'none' || term.backing.kind === 'said-no');

/** A missing term the fact bank has: what to do, why, and where the posting asks for it. */
function TermToAdd({ term }: { term: KeyTerm }) {
  if (!isToAdd(term.backing)) return null;
  const advice = adviceOf(term.backing);
  return (
    <li className={styles.term}>
      <div className={styles.termHead}>
        <span className={styles.termName}>{term.term}</span>
        <span className={`${styles.advice} ${advice.tone}`}>{advice.label}</span>
      </div>
      <p className={styles.termWhy}>{advice.why}</p>
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
  // Ones to add now come before ones to check first.
  const adding = terms
    .filter(toAdd)
    .sort((a, b) => (a.backing.kind === 'facts' ? 0 : 1) - (b.backing.kind === 'facts' ? 0 : 1));
  const gaps = terms.filter(isGap);
  const otherNames = found.filter((term) => term.otherName);
  return (
    <Group title={title} count={`${found.length} of ${terms.length} on your resume`}>
      <div className={styles.termGroup}>
        {adding.length > 0 && (
          <ul className={styles.terms} aria-label="To add">
            {adding.map((term) => (
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
                  title={
                    term.backing.kind === 'said-no'
                      ? `You said: “${term.backing.where}”`
                      : `From the posting: “${term.context}”`
                  }
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
    </Group>
  );
}

/** Whether any of the terms is a real gap, or one the user said they don't have. */
const hasGap = (terms: readonly KeyTerm[]) => terms.some(isGap);

/** The posting's key terms, found or missing, and for each one missing, what's honest to do. */
export function KeywordsView({ result, hasPosting }: { result: XRay; hasPosting: boolean }) {
  const keywords = result.keywords;
  if (!result.readable) {
    return (
      <p className={styles.empty}>There’s no text in this file to check the posting’s terms in.</p>
    );
  }
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
        {keywords.bank === 'some' &&
          ' Some of your fact bank’s files couldn’t be read, so what it backs says to check it first.'}
        {keywords.bank === 'none' && ' Your fact bank couldn’t be read, so no term says to add it.'}
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
      <Group title="Contact">
        <dl className={styles.rows}>
          <Row label="Name" value={fields.name} />
          <Row label="Email" value={fields.email} />
          <Row label="Phone" value={fields.phone} />
          <Row label="City" value={fields.location} />
          <Row label="Links" value={fields.links.length > 0 ? fields.links.join(', ') : null} />
        </dl>
      </Group>
      <Group title="Jobs" count={fields.jobs.length}>
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
      </Group>
      {fields.education.length > 0 && (
        <Group title="Education">
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
        </Group>
      )}
      <Group title="Skills" count={fields.skills.length}>
        {fields.skills.length === 0 ? (
          <p className={styles.empty}>None found under a skills heading.</p>
        ) : (
          <ul className={styles.skills}>
            {fields.skills.map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        )}
      </Group>
      <Group title="Sections it recognizes">
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
      </Group>
    </div>
  );
}
