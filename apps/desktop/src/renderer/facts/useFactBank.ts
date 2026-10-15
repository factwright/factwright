import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { FactBank } from '../../shared/facts.ts';

export type FactBankApi = Pick<
  FactwrightApi,
  | 'factBank'
  | 'changeFact'
  | 'addFact'
  | 'removeFact'
  | 'confirmFact'
  | 'removeGap'
  | 'onProfileChanged'
>;

/**
 * The fact bank, kept in step with the workspace: Claude adds and confirms facts as it goes, and
 * other computers sync theirs. A read that comes back after a newer one is dropped.
 */
export function useFactBank(api: FactBankApi) {
  const [bank, setBank] = useState<FactBank | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reads = useRef(0);

  const reload = useCallback(async () => {
    const read = ++reads.current;
    try {
      const next = await api.factBank();
      if (read !== reads.current) return;
      setBank(next);
      setProblem(null);
    } catch {
      if (read === reads.current) setProblem('Your fact bank didn’t load. Try again in a moment.');
    }
  }, [api]);

  useEffect(() => {
    void reload();
    return api.onProfileChanged(() => void reload());
  }, [api, reload]);

  /** Takes the bank a change answered with, which is newer than any read still on its way. */
  const take = useCallback((next: FactBank) => {
    reads.current += 1;
    setBank(next);
    setProblem(null);
  }, []);

  return { bank, problem, reload, take };
}
