import { SegmentedControl } from '@factwright/ui';
import { useEffect, useId, useMemo } from 'react';
import {
  type AboutYou,
  type AnswerChanges,
  pagesFor,
  RESUME_FILES,
} from '../../../shared/about.ts';
import type { FactwrightApi } from '../../../shared/api.ts';
import { suggestLooks } from '../../../shared/looks.ts';
import { TemplateGallery } from '../TemplateGallery.tsx';
import styles from './steps.module.css';

/**
 * How the user's resumes look: the templates they like, one for each kind of company they're
 * aiming at, with the ones that suit them marked; how long resumes run; and which files to make.
 */
export function TemplatesStep({
  answers,
  update,
  api,
}: {
  answers: AboutYou;
  update: (changes: AnswerChanges) => void;
  api: Pick<FactwrightApi, 'templatePreview'>;
}) {
  const titleId = useId();
  const suggestions = useMemo(() => suggestLooks(answers), [answers]);
  const suggestedPages = pagesFor({ ...answers, pages: null });

  // The first time here, the suggested templates start picked.
  // Only on arrival: once the user has picked, their picks stand, even none.
  useEffect(() => {
    if (answers.looks.length === 0) {
      update({ looks: suggestions.map(({ layout, for: kind }) => ({ layout, for: kind })) });
    }
  }, []);

  const several = answers.companies.length > 1;
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          Pick your resume templates
        </h2>
        <p className={styles.lead}>
          {several
            ? 'Choose the looks you like, and which kind of company each one is for. The ones marked Suggested suit what you’re looking for.'
            : 'Choose the looks you like. The ones marked Suggested suit what you’re looking for, and you can change them any time.'}
        </p>
      </div>

      <TemplateGallery
        answers={answers}
        suggestions={suggestions}
        api={api}
        onLooks={(looks) => update({ looks })}
      />

      <div className={styles.fields}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Length</h3>
          <SegmentedControl
            label="Length"
            options={[
              {
                value: 'suggested',
                label: `Suggested (${suggestedPages === 1 ? 'one page' : 'two pages'})`,
              },
              { value: '1', label: 'One page' },
              { value: '2', label: 'Two pages' },
            ]}
            value={answers.pages === null ? 'suggested' : String(answers.pages)}
            onChange={(value) =>
              update({ pages: value === 'suggested' ? null : (Number(value) as 1 | 2) })
            }
          />
          <p className={styles.note}>
            One page suits early careers; two give more room to experienced people.
          </p>
        </div>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Files</h3>
          <SegmentedControl
            label="Files"
            options={RESUME_FILES.map(([value, label]) => ({ value, label }))}
            value={answers.format}
            onChange={(format) => update({ format })}
          />
          <p className={styles.note}>
            PDF suits most applications. Some company sites read Word files better.
          </p>
        </div>
      </div>
    </section>
  );
}
