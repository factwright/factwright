import { type KindSearches, MOST_CITIES, MOST_TITLES } from '../../shared/browser-searches.ts';
import styles from './BrowserSearches.module.css';
import { FoldedCard } from './FoldedCard.tsx';

/** A kind of job's searches, under each place they look: its titles, with a link per site. */
function Searches({ kind: { name, searches } }: { kind: KindSearches }) {
  const places = [...new Set(searches.map(({ where }) => where))];
  return places.map((where) => (
    <div key={where} className={styles.place}>
      <p className={styles.where}>{where}</p>
      <ul className={styles.searches} aria-label={name ? `${name}: ${where}` : where}>
        {searches
          .filter((search) => search.where === where)
          .map(({ title, links }) => (
            <li key={title} className={styles.search}>
              <span className={styles.title}>{title}</span>
              <span className={styles.links}>
                {links.map(({ site, url }) => (
                  <a
                    key={site}
                    className={styles.link}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${title}, ${where}, on ${site}`}
                  >
                    {site}
                  </a>
                ))}
              </span>
            </li>
          ))}
      </ul>
    </div>
  ));
}

/**
 * Ready-made searches for the user to open in their own browser, for each job title and place
 * they want, where they see far more of LinkedIn and Indeed than a web search can. Each is a link
 * that leaves the app as any other does (main/security.ts), and only on a click. It's folded until
 * opened, under the places that a web search sees only some of.
 */
export function BrowserSearches({
  kinds,
  profileName,
  onOpenExtension,
  onOpenProfile,
}: {
  /** The kinds of job the dialog is looking for, each with its searches. */
  kinds: readonly KindSearches[];
  /** What the sidebar calls the place to add job titles: Profile, or Get started until then. */
  profileName: string;
  onOpenExtension: () => void;
  onOpenProfile: () => void;
}) {
  const count = kinds.reduce((all, kind) => all + kind.searches.length, 0);
  const profile = (
    <button type="button" className={styles.link} onClick={onOpenProfile}>
      {profileName}
    </button>
  );
  return (
    <FoldedCard
      title="Look on LinkedIn and Indeed yourself"
      summary={
        count === 0
          ? 'Needs your job titles'
          : `${count} ready-made ${count === 1 ? 'search' : 'searches'}`
      }
    >
      {count === 0 ? (
        <p className={styles.hint}>
          Add the job titles you want in {profile}, under What you want, and ready-made searches to
          open in your browser show up here.
        </p>
      ) : (
        <>
          <p className={styles.hint}>
            Each opens in your own browser, where you’ll see far more than a web search can. The{' '}
            <button type="button" className={styles.link} onClick={onOpenExtension}>
              browser extension
            </button>{' '}
            saves a job from those pages with a click.
          </p>
          {kinds.map((kind) => (
            <div key={kind.id} className={styles.kind}>
              {kinds.length > 1 && <h3 className={styles.kindName}>{kind.name}</h3>}
              {kind.searches.length > 0 ? (
                <Searches kind={kind} />
              ) : (
                <p className={styles.hint}>
                  No job titles yet. Add them in {profile}, under What you want.
                </p>
              )}
            </div>
          ))}
          {kinds.some((kind) => kind.cut) && (
            <p className={styles.hint}>
              These are for your first {MOST_TITLES} job titles and {MOST_CITIES} cities.
            </p>
          )}
        </>
      )}
    </FoldedCard>
  );
}
