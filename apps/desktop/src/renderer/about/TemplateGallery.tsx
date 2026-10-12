import { type Layout, TEMPLATES, type Template } from '@factwright/engine/templates';
import { Checkbox, Dialog, Field, Pill, Select } from '@factwright/ui';
import { Maximize2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type AboutYou,
  COMPANY_KINDS,
  type CompanyKind,
  type Look,
  labelOf,
} from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import { type Suggestion, suggestedFor } from '../../shared/looks.ts';
import type { PageImage } from '../jobs/pdf.ts';
import styles from './TemplateGallery.module.css';

type PreviewApi = Pick<FactwrightApi, 'templatePreview'>;

/** How wide a card's page shows, in CSS pixels. */
const THUMB_WIDTH = 236;
/** How wide the larger preview's page shows. */
const LARGE_WIDTH = 640;

/** A template's first page, drawn from its printed preview, or null while it draws. */
function usePage(
  api: PreviewApi,
  layout: Layout,
  name: string,
  width: number,
): PageImage | null | 'failed' {
  const [page, setPage] = useState<PageImage | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    setPage(null);
    (async () => {
      const preview = await api.templatePreview(layout, name);
      if (!preview.ok) return 'failed' as const;
      const { drawPages } = await import('../jobs/pdf.ts');
      return (await drawPages(preview.data, width))[0] ?? ('failed' as const);
    })().then(
      (drawn) => live && setPage(drawn),
      () => live && setPage('failed'),
    );
    return () => {
      live = false;
    };
  }, [api, layout, name, width]);
  return page;
}

function Page({ page, alt }: { page: PageImage | null | 'failed'; alt: string }) {
  if (page === null) return <span className={styles.drawing} aria-hidden="true" />;
  if (page === 'failed') return <span className={styles.failed}>No preview</span>;
  return (
    <img className={styles.page} src={page.url} width={page.width} height={page.height} alt={alt} />
  );
}

/** "Suggested for startups and established companies". */
const suggestionLine = (kinds: readonly (CompanyKind | 'any')[]) => {
  const named = kinds.filter((kind): kind is CompanyKind => kind !== 'any');
  if (named.length === 0) return 'Suggested for you';
  return `Suggested for ${named.map((kind) => labelOf(COMPANY_KINDS, kind).toLowerCase()).join(' and ')}`;
};

function TemplateCard({
  template,
  look,
  kinds,
  suggested,
  name,
  api,
  onToggle,
  onFor,
  onEnlarge,
}: {
  template: Template;
  /** The user's look for it, when they picked it. */
  look: Look | undefined;
  /** The kinds of company the user is aiming at, when there's more than one. */
  kinds: readonly CompanyKind[];
  suggested: (CompanyKind | 'any')[];
  name: string;
  api: PreviewApi;
  onToggle: (on: boolean) => void;
  onFor: (kind: Look['for']) => void;
  onEnlarge: () => void;
}) {
  const page = usePage(api, template.layout, name, THUMB_WIDTH);
  return (
    <li className={styles.card} data-picked={look ? '' : undefined}>
      <button
        type="button"
        className={styles.thumb}
        aria-label={`See ${template.name} larger`}
        onClick={onEnlarge}
      >
        <Page page={page} alt="" />
        <span className={styles.enlarge} aria-hidden="true">
          <Maximize2 size={14} />
        </span>
      </button>
      <div className={styles.meta}>
        <div className={styles.nameRow}>
          <h3 className={styles.name}>{template.name}</h3>
          {suggested.length > 0 && <Pill tone="green">Suggested</Pill>}
        </div>
        <p className={styles.look}>{template.look}</p>
        {suggested.length > 0 && <p className={styles.why}>{suggestionLine(suggested)}</p>}
        <Checkbox
          label="Use this template"
          checked={look !== undefined}
          onChange={(event) => onToggle(event.target.checked)}
        />
        {look && kinds.length > 1 && (
          <Field label="Use it for">
            {(control) => (
              <Select
                {...control}
                value={look.for}
                onChange={(event) => onFor(event.target.value as Look['for'])}
              >
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {labelOf(COMPANY_KINDS, kind)}
                  </option>
                ))}
                <option value="any">Any job</option>
              </Select>
            )}
          </Field>
        )}
      </div>
    </li>
  );
}

/** A template's page, larger, to read before picking it. */
function LargePreview({
  template,
  name,
  api,
  onClose,
}: {
  template: Template;
  name: string;
  api: PreviewApi;
  onClose: () => void;
}) {
  const page = usePage(api, template.layout, name, LARGE_WIDTH);
  return (
    <Dialog title={template.name} description={template.look} size="lg" onClose={onClose}>
      <div className={styles.large} aria-busy={page === null}>
        <Page page={page} alt={`A sample resume in the ${template.name} template`} />
      </div>
    </Dialog>
  );
}

/**
 * Every resume template, drawn from a real print of a sample resume, with the user's own name
 * once they've given it. The user picks any number; the ones that suit what they're looking for
 * are marked, and when they aim at more than one kind of company, each pick says which it's for.
 */
export function TemplateGallery({
  answers,
  suggestions,
  api,
  onLooks,
}: {
  answers: Pick<AboutYou, 'looks' | 'companies' | 'you'>;
  suggestions: readonly Suggestion[];
  api: PreviewApi;
  onLooks: (looks: Look[]) => void;
}) {
  const [enlarged, setEnlarged] = useState<Template | null>(null);
  const kinds = answers.companies;
  const name = answers.you.name.trim();
  const lookOf = (layout: Layout) => answers.looks.find((look) => look.layout === layout);

  const toggle = (layout: Layout, on: boolean) => {
    const others = answers.looks.filter((look) => look.layout !== layout);
    if (!on) return onLooks(others);
    // A new pick is for the kind of company it's suggested for and isn't covered yet.
    const covered = new Set(others.map((look) => look.for));
    const kind =
      suggestedFor(layout, suggestions).find((each) => !covered.has(each)) ??
      kinds.find((each) => !covered.has(each)) ??
      (kinds.length > 1 ? (kinds[0] as CompanyKind) : 'any');
    onLooks([...others, { layout, for: kinds.length > 1 ? kind : 'any' }]);
  };

  return (
    <>
      <ul className={styles.grid}>
        {TEMPLATES.map((template) => (
          <TemplateCard
            key={template.layout}
            template={template}
            look={lookOf(template.layout)}
            kinds={kinds}
            suggested={suggestedFor(template.layout, suggestions)}
            name={name}
            api={api}
            onToggle={(on) => toggle(template.layout, on)}
            onFor={(kind) =>
              onLooks(
                answers.looks.map((look) =>
                  look.layout === template.layout ? { ...look, for: kind } : look,
                ),
              )
            }
            onEnlarge={() => setEnlarged(template)}
          />
        ))}
      </ul>
      {enlarged && (
        <LargePreview template={enlarged} name={name} api={api} onClose={() => setEnlarged(null)} />
      )}
    </>
  );
}
