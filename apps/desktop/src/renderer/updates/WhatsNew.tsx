import { Dialog, Markdown } from '@factwright/ui';

/** An update's notes, from What's new. */
export function WhatsNew({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: string;
  onClose: () => void;
}) {
  return (
    <Dialog title={`What’s new in Factwright ${version}`} size="lg" onClose={onClose}>
      <Markdown text={notes} />
    </Dialog>
  );
}
