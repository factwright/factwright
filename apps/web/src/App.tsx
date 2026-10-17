import { localDate } from '@factwright/core';
import type { AccountKeys, Legal } from '@factwright/sync';
import { Button } from '@factwright/ui';
import { useCallback, useEffect, useState } from 'react';
import { Account } from './Account.tsx';
import { ApproveDevice } from './ApproveDevice.tsx';
import { Dashboard } from './Dashboard.tsx';
import { JobView } from './JobView.tsx';
import { forgetKeys, savedKeys } from './keys.ts';
import { LinkBrowser } from './LinkBrowser.tsx';
import page from './page.module.css';
import { navigate, replace, usePath } from './route.ts';
import { PageLink, Shell } from './Shell.tsx';
import { SignIn } from './SignIn.tsx';
import {
  client,
  getSession,
  type Provider,
  type ServerOptions,
  type Session,
  signInOptions,
} from './server.ts';
import { openVault, type Vault } from './vault.ts';

type State =
  | { stage: 'loading' }
  /** The server couldn't say who's signed in: offline, or busy. */
  | { stage: 'unreachable' }
  | { stage: 'signed-out'; providers: Provider[]; legal: Legal | null }
  | {
      stage: 'signed-in';
      session: Session;
      providers: Provider[];
      features: ServerOptions['features'];
      legal: Legal | null;
      keys: AccountKeys | null;
    };

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

/** Whether the server said this browser isn't signed in any more. */
const signedOut = (error: unknown) =>
  error instanceof Error && 'kind' in error && error.kind === 'signed-out';

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
      const [session, { providers, features, legal }] = await Promise.all([
        getSession(),
        signInOptions(),
      ]);
      if (session === undefined) {
        setState({ stage: 'unreachable' });
        return;
      }
      if (!session) {
        // Signed out from another device, run out, or the account deleted: this browser's keys
        // go too, as signing out here forgets them. The sign-in page doesn't wait for them to go.
        void forgetKeys().catch(() => {});
        setState({ stage: 'signed-out', providers, legal });
        return;
      }
      // Signed in, the code is used from here, once. A code that didn't work isn't tried again.
      sessionStorage.removeItem(LINK_CODE);
      setState({
        stage: 'signed-in',
        session,
        providers,
        features,
        legal,
        keys: await savedKeys(session.user.id),
      });
    })();
  }, []);

  const keys = state.stage === 'signed-in' ? state.keys : null;

  // Signed out from elsewhere while the page was open, such as from a computer after this phone
  // was lost: the job hunt it shows and the keys it keeps go at once, not at the next reload.
  const forgetHere = useCallback(() => {
    setVault(null);
    void forgetKeys().catch(() => {});
    setState((current) => ({
      stage: 'signed-out',
      providers: 'providers' in current ? current.providers : [],
      legal: 'legal' in current ? current.legal : null,
    }));
  }, []);

  const refresh = useCallback(async () => {
    if (!keys) return;
    setRefreshing(true);
    try {
      setVault(await openVault(client, keys));
      setLoadedAt(Date.now());
      setProblem(null);
    } catch (error) {
      if (signedOut(error)) {
        forgetHere();
        return;
      }
      setProblem(
        error instanceof Error && 'kind' in error && error.kind === 'offline'
          ? 'Can’t reach Factwright right now. Check your connection.'
          : 'Your job hunt couldn’t be loaded. Try again in a moment.',
      );
    } finally {
      setRefreshing(false);
    }
  }, [keys, forgetHere]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // An address from before pages had codes names the company: once the job hunt is open and
  // it matches no job, it's replaced, so it isn't left in the address bar or the tab's back list.
  useEffect(() => {
    if (!vault || !path.startsWith('/jobs/')) return;
    const code = path.slice('/jobs/'.length);
    if (![...vault.pages.values()].includes(code)) replace('/');
  }, [vault, path]);

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

  if (state.stage === 'unreachable') {
    return (
      <Shell>
        <section className={page.card} aria-labelledby="unreachable-title">
          <h1 id="unreachable-title" className={page.title}>
            Can’t reach Factwright right now
          </h1>
          <p className={page.lead}>Check your connection, then try again.</p>
          <div className={page.actions}>
            <Button variant="primary" onClick={() => location.reload()}>
              Try again
            </Button>
          </div>
        </section>
      </Shell>
    );
  }

  if (state.stage === 'signed-out') {
    const { providers, legal } = state;
    if (path === '/device') {
      return (
        <Shell>
          <SignIn
            providers={providers}
            legal={legal}
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
          legal={legal}
          {...(linkCode && {
            title: 'Link this phone',
            lead: 'Sign in with the account you use in Factwright, to link this phone.',
          })}
          returnTo={linkCode ? '/link' : '/'}
        />
      </Shell>
    );
  }

  const { session, providers, features, legal } = state;
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
        <Account
          email={session.user.email}
          vault={vault}
          keys={keys}
          providers={providers}
          legal={legal}
          onSignedOut={forgetHere}
        />
      </Shell>
    );
  }

  if (!keys || path === '/link') {
    return (
      <Shell nav={nav}>
        <LinkBrowser
          account={session.user.id}
          email={session.user.email}
          // A browser that's linked already, back here from a QR code, doesn't ask again.
          canApprove={features.includes('approve') && !keys}
          code={linkCode}
          onSignedOut={forgetHere}
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
        <JobView job={job} vault={vault} keys={keys} today={today} onSignedOut={forgetHere} />
      ) : (
        <Dashboard vault={vault} today={today} refreshing={refreshing} onRefresh={refresh} />
      )}
    </Shell>
  );
}
