import { Button, Checkbox, Dialog, Field, FileDrop, Pill, Select } from '@factwright/ui';
import { Maximize2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  type AboutYou,
  COMPANY_KINDS,
  type CompanyKind,
  type Look,
  labelOf,
} from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import { type Suggestion, suggestedFor } from '../../shared/looks.ts';
import type { TemplateInfo } from '../../shared/profile.ts';
import type { PageImage } from '../jobs/pdf.ts';
import styles from './TemplateGallery.module.css';

type GalleryApi = Pick<FactwrightApi, 'templatePreview' | 'addTemplate' | 'removeTemplate'>;

/** How wide a card's page shows, in CSS pixels. */
const THUMB_WIDTH = 236;
/** How wide the larger preview's page shows. */
const LARGE_WIDTH = 640;

/** The files Claude can copy a resume's look from. */
const COPYABLE = '.pdf,.png,.jpg,.jpeg,.webp';

/** A template's first page, drawn from its printed preview, or null while it draws. */
function usePage(
  api: GalleryApi,
  template: TemplateInfo,
  name: string,
  width: number,
): PageImage | null | 'failed' {
  const [page, setPage] = useState<PageImage | null | 'failed'>(null);
  const { id, stamp } = template;
  // A new stamp means the template changed, so it's drawn again.
  useEffect(() => {
    let live = true;
    setPage(null);
    (async () => {
      const preview = await api.templatePreview(id, name);
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
  }, [api, id, stamp, name, width]);
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
  onRemove,
}: {
  template: TemplateInfo;
  /** The user's look for it, when they picked it. */
  look: Look | undefined;
  /** The kinds of company the user is aiming at, when there's more than one. */
  kinds: readonly CompanyKind[];
  suggested: (CompanyKind | 'any')[];
  name: string;
  api: GalleryApi;
  onToggle: (on: boolean) => void;
  onFor: (kind: Look['for']) => void;
  onEnlarge: () => void;
  onRemove: () => void;
}) {
  const page = usePage(api, template, name, THUMB_WIDTH);
  const [removing, setRemoving] = useState(false);
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
          {template.own && <Pill tone="violet">Yours</Pill>}
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
        {template.own &&
          (removing ? (
            // biome-ignore lint/a11y/useSemanticElements: a group of two buttons, not a form.
            <div className={styles.confirm} role="group" aria-label={`Remove ${template.name}?`}>
              <p className={styles.confirmText}>
                Remove {template.name}? It goes to the trash. Resumes in it keep their files, but
                can’t be built in it again.
              </p>
              <div className={styles.confirmButtons}>
                <Button size="sm" variant="primary" onClick={onRemove}>
                  Remove
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setRemoving(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="quiet"
              className={styles.remove}
              aria-label={`Remove ${template.name}`}
              onClick={() => setRemoving(true)}
            >
              Remove
            </Button>
          ))}
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
  template: TemplateInfo;
  name: string;
  api: GalleryApi;
  onClose: () => void;
}) {
  const page = usePage(api, template, name, LARGE_WIDTH);
  return (
    <Dialog title={template.name} description={template.look} size="lg" onClose={onClose}>
      <div className={styles.large} aria-busy={page === null}>
        <Page page={page} alt={`A sample resume in the ${template.name} template`} />
      </div>
    </Dialog>
  );
}

/**
 * Where the user brings a template they like: a resume whose look they like, as a PDF or a
 * picture, which their Claude makes a template from, or a template file someone shared.
 */
function BringTemplate({
  api,
  canMake,
  onMake,
}: {
  api: GalleryApi;
  canMake: boolean;
  onMake: (source: string) => void;
}) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const titleId = useId();

  const add = async (file: File) => {
    const template = /\.json$/i.test(file.name);
    if (!template && !canMake) {
      setStatus({
        ok: false,
        text: 'Your Claude can’t start right now. Once it’s ready, and done with what it’s doing, add the resume again.',
      });
      return;
    }
    setAdding(true);
    setStatus(null);
    try {
      const result = await api.addTemplate({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (!result.ok) setStatus({ ok: false, text: result.message });
      else if (result.kind === 'copy') {
        setStatus({
          ok: true,
          text: 'Your Claude is making a template in its look. It shows up here once it’s saved.',
        });
        onMake(result.source);
      } else {
        setStatus({
          ok: true,
          text: result.already
            ? `You have ${result.name} already.`
            : `Added ${result.name}. Pick it to use it.`,
        });
      }
    } catch {
      setStatus({ ok: false, text: 'That file couldn’t be added. Try again.' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className={styles.bring} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.bringTitle}>
        Bring a template you like
      </h3>
      <FileDrop
        title="Drop a resume whose look you like"
        hint="A PDF or a picture: your Claude makes a template with its layout, fonts and colors, never its words. A Word file? Save it as a PDF first. A template file (.json) someone shared works too."
        buttonLabel="Choose a file"
        accept={`${COPYABLE},.json`}
        multiple={false}
        disabled={adding}
        onFiles={([file]) => file && void add(file)}
      />
      {status && (
        <p
          className={status.ok ? styles.added : styles.problem}
          role={status.ok ? 'status' : 'alert'}
        >
          {status.text}
        </p>
      )}
    </section>
  );
}

/**
 * Every resume template the user can pick, the app's and their own, each drawn from a real
 * print of a sample resume, with the user's own name once they've given it. The user picks any
 * number; the ones that suit what they're looking for are marked, and when they aim at more than
 * one kind of company, each pick says which it's for. They can bring templates of their own too,
 * and remove those.
 */
export function TemplateGallery({
  answers,
  templates,
  suggestions,
  api,
  canMake,
  onLooks,
  onMake,
}: {
  answers: Pick<AboutYou, 'looks' | 'companies' | 'you'>;
  templates: readonly TemplateInfo[];
  suggestions: readonly Suggestion[];
  api: GalleryApi;
  /** Whether Claude can start making a template now. */
  canMake: boolean;
  onLooks: (looks: Look[]) => void;
  /** Starts Claude making a template from a resume the app kept. */
  onMake: (source: string) => void;
}) {
  const [enlarged, setEnlarged] = useState<TemplateInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const kinds = answers.companies;
  const name = answers.you.name.trim();
  const lookOf = (id: string) => answers.looks.find((look) => look.layout === id);

  const toggle = (id: string, on: boolean) => {
    const others = answers.looks.filter((look) => look.layout !== id);
    if (!on) return onLooks(others);
    // A new pick is for the kind of company it's suggested for and isn't covered yet.
    const covered = new Set(others.map((look) => look.for));
    const kind =
      suggestedFor(id, suggestions).find((each) => !covered.has(each)) ??
      kinds.find((each) => !covered.has(each)) ??
      (kinds.length > 1 ? (kinds[0] as CompanyKind) : 'any');
    onLooks([...others, { layout: id, for: kinds.length > 1 ? kind : 'any' }]);
  };

  const remove = async (template: TemplateInfo) => {
    setProblem(null);
    const removed = await api.removeTemplate(template.id).catch(() => null);
    if (!removed?.ok) setProblem(removed?.message ?? `${template.name} couldn’t be removed.`);
  };

  return (
    <>
      <ul className={styles.grid}>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            look={lookOf(template.id)}
            kinds={kinds}
            suggested={suggestedFor(template.id, suggestions)}
            name={name}
            api={api}
            onToggle={(on) => toggle(template.id, on)}
            onFor={(kind) =>
              onLooks(
                answers.looks.map((look) =>
                  look.layout === template.id ? { ...look, for: kind } : look,
                ),
              )
            }
            onEnlarge={() => setEnlarged(template)}
            onRemove={() => void remove(template)}
          />
        ))}
      </ul>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <BringTemplate api={api} canMake={canMake} onMake={onMake} />
      {enlarged && (
        <LargePreview template={enlarged} name={name} api={api} onClose={() => setEnlarged(null)} />
      )}
    </>
  );
}
