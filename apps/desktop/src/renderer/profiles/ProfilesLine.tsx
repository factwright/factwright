import { Button } from '@factwright/ui';
import type { ProfileEntry } from '../../shared/profiles.ts';
import styles from './Profiles.module.css';

/**
 * A quiet line at the bottom of the Profile page: where a profile for someone else starts, and
 * once there are several, where they're managed.
 */
export function ProfilesLine({
  profiles,
  onAdd,
  onManage,
}: {
  profiles: ProfileEntry[];
  onAdd: () => void;
  onManage: () => void;
}) {
  const open = profiles.find((profile) => profile.open);
  return (
    <section className={styles.share} aria-label="Profiles">
      <p className={styles.shareText}>
        {profiles.length > 1 && open ? (
          <>
            <strong>{profiles.length} profiles on this computer.</strong> This one is {open.name}.
            Switch from the top of the sidebar.
          </>
        ) : (
          <>
            <strong>Sharing this computer?</strong> Each person can have a profile of their own,
            with their own job hunt, sync and Claude.
          </>
        )}
      </p>
      <div className={styles.shareActions}>
        {profiles.length > 1 && (
          <Button size="sm" variant="quiet" onClick={onManage}>
            Manage profiles
          </Button>
        )}
        <Button size="sm" onClick={onAdd}>
          Add a profile
        </Button>
      </div>
    </section>
  );
}
