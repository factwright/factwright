import { Check, ChevronsUpDown, Plus, UsersRound } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { ProfileEntry } from '../../shared/profiles.ts';
import { ProfileAvatar } from './ProfileAvatar.tsx';
import styles from './Profiles.module.css';

/**
 * The open profile, at the top of the sidebar once there's more than one. Its menu switches to
 * another, which restarts Factwright on it, adds one, or manages them. Switching waits while
 * Claude is working, as restarting would stop it.
 */
export function ProfileSwitcher({
  profiles,
  busy,
  onOpen,
  onAdd,
  onManage,
}: {
  profiles: ProfileEntry[];
  /** Whether Claude is working, which switching would stop. */
  busy: boolean;
  onOpen: (profile: ProfileEntry) => void;
  onAdd: () => void;
  onManage: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const noteId = useId();
  const current = profiles.find((profile) => profile.open);

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !button.current?.contains(target)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);

  // The menu opens on the profile that's open, so the arrow keys move from there.
  useEffect(() => {
    if (!expanded) return;
    popup.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [expanded]);

  const close = (refocus: boolean) => {
    setExpanded(false);
    if (refocus) button.current?.focus();
  };
  const choose = (action: () => void) => {
    close(true);
    action();
  };

  // The menu's keys, as menus everywhere take them: arrows, Home and End move, Escape closes.
  const onMenuKey = (event: KeyboardEvent) => {
    const items = [...(popup.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focus = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close(false);
  };

  if (!current) return null;
  return (
    <div className={styles.switcher}>
      <button
        ref={button}
        type="button"
        className={styles.switch}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        aria-label={`${current.name}, switch profiles`}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setExpanded(true);
          }
        }}
      >
        <ProfileAvatar id={current.id} name={current.name} />
        <span className={styles.switchName}>{current.name}</span>
        <ChevronsUpDown className={styles.chevrons} size={14} aria-hidden="true" />
      </button>
      {expanded && (
        <div ref={popup} className={styles.popup}>
          <div
            id={menuId}
            role="menu"
            aria-label="Profiles"
            aria-describedby={busy ? noteId : undefined}
            className={styles.menu}
            onKeyDown={onMenuKey}
          >
            {profiles.map((profile) => {
              const waits = busy && !profile.open;
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={profile.open}
                  aria-disabled={waits || undefined}
                  tabIndex={-1}
                  className={styles.item}
                  onClick={() => {
                    if (profile.open) close(true);
                    else if (!waits) choose(() => onOpen(profile));
                  }}
                >
                  <ProfileAvatar id={profile.id} name={profile.name} />
                  <span className={styles.itemName}>{profile.name}</span>
                  {profile.open && <Check className={styles.check} size={14} aria-hidden="true" />}
                </button>
              );
            })}
            <hr className={styles.separator} />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              onClick={() => choose(onAdd)}
            >
              <Plus className={styles.itemIcon} size={14} aria-hidden="true" />
              Add a profile…
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              onClick={() => choose(onManage)}
            >
              <UsersRound className={styles.itemIcon} size={14} aria-hidden="true" />
              Manage profiles…
            </button>
          </div>
          {busy && (
            <p id={noteId} className={styles.menuNote}>
              Stop Claude’s run first, as switching restarts Factwright.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
