import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ProfileList } from '../../shared/profiles.ts';

/** The profiles on this computer, once they've loaded, and a way to read them again. */
export function useProfiles(api: Pick<FactwrightApi, 'profiles'>): {
  list: ProfileList | null;
  reload: () => void;
} {
  const [list, setList] = useState<ProfileList | null>(null);
  const reload = useCallback(() => {
    api.profiles().then(setList, () => {});
  }, [api]);
  useEffect(reload, [reload]);
  return { list, reload };
}
