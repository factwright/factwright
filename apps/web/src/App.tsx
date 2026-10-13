import { localDate } from '@factwright/core';
import type { AccountKeys } from '@factwright/sync';
import { useCallback, useEffect, useState } from 'react';
import { Account } from './Account.tsx';
import { ApproveDevice } from './ApproveDevice.tsx';
import { Dashboard } from './Dashboard.tsx';
import { JobView } from './JobView.tsx';
import { forgetKeys, savedKeys } from './keys.ts';
import { LinkBrowser } from './LinkBrowser.tsx';
import page from './page.module.css';
import { navigate, usePath } from './route.ts';
import { PageLink, Shell } from './Shell.tsx';
import { SignIn } from './SignIn.tsx';
import { client, getSession, type Provider, type Session, signInOptions } from './server.ts';
import { openVault, type Vault } from './vault.ts';

type State =
  | { stage: 'loading' }
  | { stage: 'signed-out'; providers: Provider[] }
  | { stage: 'signed-in'; session: Session; providers: Provider[]; keys: AccountKeys | null };

const LINK_CODE = 'factwright-link-code';

/**
 * A link code from a QR code's address. It's taken out of the address at once, so it isn't
 * left in the browser's history, and kept for this tab only, until it's signed in.
 */
function takeLinkCode(): string | null {
  const code = location.hash.slice(1);
  if (code) {
    sessionStorage.setItem(LINK_CODE, code);
    history.replaceState(null, '', location.pathname + location.search);
  }
  return sessionStorage.getItem(LINK_CODE);
}

/** How long the job hunt stays as loaded before coming back to the page updates it. */
const STALE_MS = 30_000;

/** The web view: signing in, linking this browser, and the job hunt, opened right here. */
export function App() {
  const path = usePath();
  const [state, setState] = useState<State>({ stage: 'loading' });
  const [linkCode] = useState(takeLinkCode);
  const [vault, setVault] = useState<Vault | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const today = localDate();

  useEffect(() => {
    void (async () => {
      const [session, providers] = await Promise.all([getSession(), signInOptions()]);
      if (!session) {
        // Signed out from another device, run out, or the account deleted: this browser's keys
        // go too, as signing out here forgets them. Not when the server just couldn't say.
        if (session === null) await forgetKeys().catch(() => {});
        setState({ stage: 'signed-out', providers });
        return;
      }
      // Signed in, the code is used from here, once. A code that didn't work isn't tried again.
      sessionStorage.removeItem(LINK_CODE);
      setState({ stage: 'signed-in', session, providers, keys: await savedKeys(session.user.id) });
    })();
  }, []);

  const keys = state.stage === 'signed-in' ? state.keys : null;

  const refresh = useCallback(async () => {
    if (!keys) return;
    setRefreshing(true);
    try {
      setVault(await openVault(client, keys));
      setLoadedAt(Date.now());
      setProblem(null);
    } catch (error) {
      setProblem(
        error instanceof Error && 'kind' in error && error.kind === 'offline'
          ? 'Can’t reach Factwright right now. Check your connection.'
          : 'Your job hunt couldn’t be loaded. Try again in a moment.',
      );
    } finally {
      setRefreshing(false);
    }
  }, [keys]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Coming back to the page brings the job hunt up to date.
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt > STALE_MS)
        void refresh();
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [refresh, loadedAt]);

  if (state.stage === 'loading') {
    return (
      <Shell>
        <p className={page.hint}>Opening…</p>
      </Shell>
    );
  }

  if (state.stage === 'signed-out') {
    const { providers } = state;
    if (path === '/device') {
      return (
        <Shell>
          <SignIn
            providers={providers}
            title="Sign in to Factwright"
            lead="Sign in to let Factwright on your computer sync your job hunt."
            returnTo={location.pathname + location.search}
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <SignIn
          providers={providers}
          {...(linkCode && {
            title: 'Link this phone',
            lead: 'Sign in with the account you use in Factwright, to link this phone.',
          })}
          returnTo={linkCode ? '/link' : '/'}
        />
      </Shell>
    );
  }

  const { session, providers } = state;
  const nav = (
    <>
      <PageLink to="/" current={path === '/' || path.startsWith('/jobs/')}>
        Jobs
      </PageLink>
      <PageLink to="/account" current={path === '/account'}>
        Account
      </PageLink>
    </>
  );

  if (path === '/device') {
    const userCode = new URLSearchParams(location.search).get('user_code') ?? '';
    return (
      <Shell nav={nav}>
        <ApproveDevice userCode={userCode} providers={providers} />
      </Shell>
    );
  }

  if (path === '/account') {
    return (
      <Shell nav={nav}>
        <Account email={session.user.email} vault={vault} keys={keys} providers={providers} />
      </Shell>
    );
  }

  if (!keys || path === '/link') {
    return (
      <Shell nav={nav}>
        <LinkBrowser
          account={session.user.id}
          code={linkCode}
          onLinked={(linked) => {
            setState({ ...state, keys: linked });
            navigate('/');
          }}
        />
      </Shell>
    );
  }

  // A job's page is named by a code, never by its ID, which names its company and role.
  const code = path.startsWith('/jobs/') ? path.slice('/jobs/'.length) : null;
  const job = code ? vault?.jobs.find((each) => vault.pages.get(each.id) === code) : undefined;
  return (
    <Shell nav={nav}>
      {problem && (
        <p className={page.problem} role="alert">
          {problem}
        </p>
      )}
      {!vault ? (
        <p className={page.hint}>{problem ? '' : 'Unlocking your job hunt…'}</p>
      ) : job ? (
        <JobView job={job} vault={vault} keys={keys} today={today} />
      ) : (
        <Dashboard vault={vault} today={today} refreshing={refreshing} onRefresh={refresh} />
      )}
    </Shell>
  );
}
