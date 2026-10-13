import { useEffect, useState } from 'react';

const CHANGED = 'factwright:navigate';

/** Goes to another page of the web view, without reloading. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(CHANGED));
}

/** Puts another page in place of this one, leaving nothing of this one's address in history. */
export function replace(path: string): void {
  history.replaceState(null, '', path);
  window.dispatchEvent(new Event(CHANGED));
}

/** The page the web view is on, kept up to date as it moves. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(CHANGED, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return path;
}
