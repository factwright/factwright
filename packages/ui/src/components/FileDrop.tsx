import { Upload } from 'lucide-react';
import { type DragEvent, type ReactNode, useId, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { Button } from './Button.tsx';
import styles from './FileDrop.module.css';

export interface FileDropProps {
  /** What to drop, such as "Drop your resumes here". */
  title: string;
  /** Which files it takes, in words. */
  hint?: ReactNode;
  /** The button that opens the system's file picker. */
  buttonLabel: string;
  /** The file types it takes, as the file picker's accept list, such as ".pdf,.docx". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}

/**
 * A place to drop files, or pick them with the system's own file picker. The window gets only the
 * files the user chose, never a path to anything else.
 */
export function FileDrop({
  title,
  hint,
  buttonLabel,
  accept,
  multiple = true,
  disabled = false,
  onFiles,
  className,
}: FileDropProps) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length > 0 && !disabled) onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDragOver = (event: DragEvent) => {
    if (disabled || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is for the mouse; the button does the same from the keyboard.
    <div
      className={cx(styles.drop, over && styles.over, disabled && styles.disabled, className)}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files);
      }}
    >
      <Upload className={styles.icon} size={20} aria-hidden="true" />
      <p className={styles.title}>{title}</p>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <Button
        size="sm"
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => picker.current?.click()}
      >
        {buttonLabel}
      </Button>
      <input
        ref={picker}
        type="file"
        className={styles.picker}
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          take(event.target.files);
          // The same file can be picked again, such as after removing it.
          event.target.value = '';
        }}
      />
    </div>
  );
}
