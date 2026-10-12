import { Button, IconButton } from '@factwright/ui';
import { ImagePlus, X } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import styles from './Screenshots.module.css';

/** A screenshot shown in a dialog: saved already, or waiting to be. */
export interface ShownShot {
  /** Its path in the workspace once saved, or a key of its own until then. */
  key: string;
  /** A data: URL of it, the only kind of picture the window's rules allow. */
  url: string;
}

/** A picture the user picked, pasted or dropped, read and ready to save. */
export interface PickedShot extends ShownShot {
  name: string;
  bytes: Uint8Array;
}

/** The pictures a screenshot can be. Claude reads them all. */
const TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The most screenshots one dialog takes at once. */
const MOST = 10;

/** A picture's bytes as a data: URL. */
export function pictureUrl(bytes: Uint8Array, type: string): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

/** The type a saved screenshot's name says it is. */
export function typeOf(path: string): string {
  const extension = path.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return extension === 'webp' || extension === 'gif' ? `image/${extension}` : 'image/png';
}

let counter = 0;

/**
 * The pictures among some files, read: a pasted screenshot comes with no name of its own, so it
 * gets one from its type.
 */
export async function readPictures(files: readonly File[]): Promise<PickedShot[]> {
  const pictures = files.filter((file) => TYPES[file.type]);
  return Promise.all(
    pictures.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extension = TYPES[file.type] ?? 'png';
      const named = /\.[a-z0-9]{2,5}$/i.test(file.name) ? file.name : `screenshot.${extension}`;
      return {
        key: `picked-${++counter}`,
        name: named,
        bytes,
        url: pictureUrl(bytes, file.type),
      };
    }),
  );
}

/** The image files in a paste, if any. */
function pastedFiles(event: ClipboardEvent): File[] {
  const items = [...(event.clipboardData?.items ?? [])];
  return items
    .filter((item) => item.kind === 'file' && TYPES[item.type])
    .flatMap((item) => item.getAsFile() ?? []);
}

/**
 * Screenshots in a dialog: the ones added so far, and a way to add more by pasting them, dropping
 * them on the dialog, or picking them with the system's file picker.
 */
export function Screenshots({
  shots,
  onAdd,
  onRemove,
  platform,
  label = 'Add screenshots',
  disabled = false,
}: {
  shots: readonly ShownShot[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  /** The computer's platform, which says which keys paste. */
  platform: string;
  label?: string;
  disabled?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const room = MOST - shots.length;
  const take = (files: File[]) => {
    const pictures = files.filter((file) => TYPES[file.type]).slice(0, Math.max(0, room));
    if (pictures.length > 0 && !disabled) onAdd(pictures);
  };
  const latest = useRef(take);
  latest.current = take;

  // A screenshot pasted anywhere in the dialog joins the others. Pasted text goes on as usual.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = pastedFiles(event);
      if (files.length === 0) return;
      event.preventDefault();
      latest.current(files);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  const onDragOver = (event: DragEvent) => {
    if (disabled || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is for the mouse; the button and pasting do the same from the keyboard.
    <div
      className={`${styles.shots} ${over ? styles.over : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take([...event.dataTransfer.files]);
      }}
    >
      {shots.length > 0 && (
        <ul className={styles.list}>
          {shots.map((shot, i) => (
            <li key={shot.key} className={styles.shot}>
              <img className={styles.picture} src={shot.url} alt={`Screenshot ${i + 1}`} />
              <IconButton
                className={styles.remove}
                label={`Remove screenshot ${i + 1}`}
                size="sm"
                icon={<X size={12} aria-hidden="true" />}
                onClick={() => onRemove(shot.key)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.add}>
        <Button
          size="sm"
          variant="quiet"
          icon={<ImagePlus size={14} aria-hidden="true" />}
          disabled={disabled || room <= 0}
          onClick={() => picker.current?.click()}
        >
          {label}
        </Button>
        <span className={styles.hint}>
          {room > 0
            ? `or paste one with ${platform === 'darwin' ? '⌘V' : 'Ctrl+V'}, or drop it here`
            : 'That’s ten, the most at once.'}
        </span>
      </div>
      <input
        ref={picker}
        type="file"
        className={styles.picker}
        tabIndex={-1}
        aria-hidden="true"
        accept={Object.keys(TYPES).join(',')}
        multiple
        onChange={(event) => {
          take([...(event.target.files ?? [])]);
          // The same file can be picked again, such as after removing it.
          event.target.value = '';
        }}
      />
    </div>
  );
}
