import type { XRay } from '@factwright/xray';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';

/** A resume's file, as the X-ray reads it. */
export interface XRayFile {
  /** Where it is in the workspace, such as "applications/acme/Resume.pdf". */
  path: string;
  name: string;
  format: 'pdf' | 'docx';
}

export type XRayState =
  | { step: 'reading' }
  | { step: 'ready'; result: XRay }
  | { step: 'failed'; message: string };

type XRayApi = Pick<FactwrightApi, 'readPdf' | 'readWord' | 'factBank'>;

/** The fact bank's files as written, which tell a term the user can add from a real gap. */
async function factFiles(api: XRayApi) {
  try {
    const bank = await api.factBank();
    return bank.files.map((file) => ({
      path: file.path,
      text: file.blocks.map((block) => block.text).join('\n'),
    }));
  } catch {
    // Without the fact bank, every missing term reads as a gap, so nothing gets added.
    return null;
  }
}

/**
 * Reads a resume's file and works out its X-ray, with the job's posting when there is one, and
 * the fact bank. It's all done here, in the window: nothing goes to Claude or anywhere else.
 */
export function useXRay(
  api: XRayApi,
  file: XRayFile,
  posting: (() => Promise<string | null>) | null,
): XRayState {
  const [state, setState] = useState<XRayState>({ step: 'reading' });

  useEffect(() => {
    let live = true;
    setState({ step: 'reading' });
    (async (): Promise<XRayState> => {
      const read =
        file.format === 'pdf' ? await api.readPdf(file.path) : await api.readWord(file.path);
      if (!read.ok) return { step: 'failed', message: read.message };
      const [{ readDocx, xray }, text, facts] = await Promise.all([
        import('@factwright/xray'),
        posting ? posting().catch(() => null) : null,
        factFiles(api),
      ]);
      const parsed =
        file.format === 'pdf'
          ? await (await import('../jobs/pdf.ts')).readResumePdf(read.data)
          : readDocx(read.data);
      return { step: 'ready', result: xray(parsed, { posting: text, facts }) };
    })().then(
      (next) => live && setState(next),
      () =>
        live &&
        setState({
          step: 'failed',
          message: 'Couldn’t read this file. Open it in its own app to check it.',
        }),
    );
    return () => {
      live = false;
    };
  }, [api, file.path, file.format, posting]);

  return state;
}
