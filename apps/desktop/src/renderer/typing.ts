/** Inputs that take a click or a pick, not typing. */
const NOT_TYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether the keyboard is in a box the user types in, outside an element: such as the box for
 * their next reply under Claude's answer in a job's panel, as a run's terminal opens in view.
 */
export function typingOutside(element: Element): boolean {
  const active = element.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || element.contains(active)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement) return true;
  return active instanceof HTMLInputElement && !NOT_TYPED.has(active.type);
}
