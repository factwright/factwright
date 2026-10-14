import type { FactwrightApi } from '../../shared/api.ts';
import { type ProfileEntry, parseProfileName, sameName } from '../../shared/profiles.ts';

type ProfilesApi = Pick<
  FactwrightApi,
  'profiles' | 'addProfile' | 'renameProfile' | 'removeProfile' | 'openProfile'
>;

/** Made-up profiles for ?profiles=: the first, someone else's, and one for trying things out. */
const PEOPLE: ProfileEntry[] = [
  { id: 'first', name: 'Alex Rivera', open: true, first: true, named: true },
  { id: '3f9c2a71d0be', name: 'Sam', open: false, first: false, named: true },
  { id: 'a84e17c5b2f0', name: 'Testing', open: false, first: false, named: true },
];

/** Where each made-up profile's Claude Code folder would be, on a Mac. */
const folder = (id: string) =>
  `/Users/alex/Library/Application Support/Factwright/Profiles/${id}/claude`;

/**
 * Profiles for the screens, kept until the page reloads. ?profiles= picks how many there are:
 * one (as for most people), two, or three with ?profiles=added, where an added one is open.
 * Opening another only says so, as the screens can't restart.
 */
export function sampleProfiles(choice: string | null): ProfilesApi {
  // With one profile, the first has no name yet, as for most people.
  let profiles =
    choice === 'added'
      ? PEOPLE.map((profile) => ({ ...profile, open: profile.id === '3f9c2a71d0be' }))
      : choice === 'two'
        ? PEOPLE.slice(0, 2)
        : [{ ...(PEOPLE[0] as ProfileEntry), name: 'First profile', named: false }];
  let next = 1;
  return {
    profiles: async () => {
      const open = profiles.find((profile) => profile.open);
      return {
        profiles,
        claudeSignIn:
          open && !open.first
            ? `CLAUDE_CONFIG_DIR='${folder(open.id)}' claude auth login`
            : 'claude auth login',
      };
    },
    addProfile: async (value, firstValue) => {
      const name = parseProfileName(value);
      if (!name) return { ok: false, message: 'Give it a name of up to 40 letters.' };
      const own = parseProfileName(firstValue);
      if (own) {
        profiles = profiles.map((profile) =>
          profile.first ? { ...profile, name: own, named: true } : profile,
        );
      }
      const taken = sameName(name, profiles);
      if (taken) return { ok: false, message: `There’s already a profile called ${taken.name}.` };
      const id = `00000000000${next++}`.slice(-12);
      profiles = [...profiles, { id, name, open: false, first: false, named: true }];
      return { ok: true, id };
    },
    renameProfile: async (id, value) => {
      const name = parseProfileName(value);
      if (!name) return { ok: false, message: 'Give it a name of up to 40 letters.' };
      const taken = sameName(name, profiles, id);
      if (taken) return { ok: false, message: `There’s already a profile called ${taken.name}.` };
      profiles = profiles.map((profile) => (profile.id === id ? { ...profile, name } : profile));
      return { ok: true };
    },
    removeProfile: async (id) => {
      profiles = profiles.filter((profile) => profile.id !== id || profile.open || profile.first);
      return { ok: true };
    },
    openProfile: async (id) => {
      const name = profiles.find((profile) => profile.id === id)?.name ?? 'that profile';
      return { ok: false, message: `Factwright would restart now, on ${name}.` };
    },
  };
}
