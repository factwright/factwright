import { checkEmoji } from '@factwright/sync';
import { Button, CheckCode } from '@factwright/ui';
import { CircleCheck, MonitorSmartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, AskingView, RequestView } from '../../shared/sync.ts';
import styles from './SyncDialog.module.css';
import { timeAgo } from './useSync.ts';

/** How long the new device waits before saying what to do if nothing shows on the other. */
const SLOW_MS = 30_000;

/** Runs a step the person started, keeping its button busy and saying why it didn't work. */
function useStep() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (step: () => Promise<EditResult>) => {
    setBusy(true);
    setProblem(null);
    const result = await step();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  };
  return { busy, problem, run };
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className={styles.problem} role="alert">
      {text}
    </p>
  ) : null;
}

/**
 * On a computer that isn't linked yet: asking a device that's set up to approve it. The person
 * checks both screens show the same emoji, and says so here too, before anything is handed over.
 */
export function AskPanel({ api, asking }: { api: FactwrightApi; asking: AskingView | null }) {
  const step = useStep();
  // A while with nothing from the other device: it may run an older Factwright.
  const [slow, setSlow] = useState(false);
  const waiting = asking === null || asking.step === 'waiting';
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (asking?.step === 'ended') {
    return (
      <div className={styles.approve} aria-live="polite">
        <p className={styles.approveText}>{asking.message}</p>
        {asking.check && (
          <CheckCode items={checkEmoji(asking.check)} label="Emoji this computer showed" quiet />
        )}
        <Problem text={step.problem} />
        <div className={styles.approveActions}>
          <Button disabled={step.busy} onClick={() => step.run(() => api.askToLink())}>
            Ask again
          </Button>
        </div>
      </div>
    );
  }

  if (asking?.step === 'check') {
    return (
      <div className={styles.approve} aria-live="polite">
        <p className={styles.approveText}>
          {asking.confirmed ? (
            <>
              Now say they match on <strong>{asking.approver}</strong> too.
            </>
          ) : (
            <>
              <strong>{asking.approver}</strong> offered to approve this computer. Check it shows
              the same emoji, in the same order:
            </>
          )}
        </p>
        <CheckCode items={checkEmoji(asking.check)} quiet={asking.confirmed} />
        {asking.confirmed && (
          <p className={styles.waiting}>
            <span className={`${styles.dot} ${styles.dotSyncing}`} aria-hidden="true" />
            Waiting for your other device…
          </p>
        )}
        {!asking.confirmed && (
          <div className={styles.approveActions}>
            <Button onClick={() => api.confirmLinkCheck(false)}>They don’t match</Button>
            <Button variant="primary" onClick={() => api.confirmLinkCheck(true)}>
              They match
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.approve} aria-live="polite">
      <div className={styles.approveLead}>
        <MonitorSmartphone size={20} aria-hidden="true" />
        <p className={styles.approveText}>
          On your other computer, open Factwright. It asks you to approve this one.
        </p>
      </div>
      <p className={styles.waiting}>
        <span className={`${styles.dot} ${styles.dotSyncing}`} aria-hidden="true" />
        Waiting for your other device…
      </p>
      {slow && (
        <p className={styles.hint}>
          Nothing showing there? Update Factwright on that computer, or type a code instead.
        </p>
      )}
    </div>
  );
}

/**
 * A request from another device, before this computer starts to approve it, with when that
 * device signed in: a sign-in from a while ago is worth a second look. "approve" says whether
 * it can be approved now, and leaves the button out for one asking while another is approved.
 */
function Request({
  api,
  request,
  approve,
}: {
  api: FactwrightApi;
  request: RequestView;
  approve: 'yes' | 'not-while-crowded' | 'no';
}) {
  const step = useStep();
  return (
    <li className={styles.request}>
      <div className={styles.requestWho}>
        <span className={styles.deviceName}>{request.device}</span>
        <span className={styles.deviceWhen}>
          {request.elsewhere
            ? 'Being approved on another device'
            : `Asked ${timeAgo(request.asked)} · signed in ${timeAgo(request.signedIn)}`}
        </span>
      </div>
      {!request.elsewhere && (
        <div className={styles.requestActions}>
          <Button
            size="sm"
            variant="quiet"
            disabled={step.busy}
            onClick={() => step.run(() => api.denyLinkRequest(request.id))}
          >
            Turn down
          </Button>
          {approve !== 'no' && (
            <Button
              size="sm"
              variant="primary"
              disabled={step.busy || approve === 'not-while-crowded'}
              onClick={() => step.run(() => api.approveLinkRequest(request.id))}
            >
              Approve…
            </Button>
          )}
        </div>
      )}
      <Problem text={step.problem} />
    </li>
  );
}

/** A request this computer just turned down, whose device the person can sign out. */
function TurnedDown({ api, device }: { api: FactwrightApi; device: string }) {
  const step = useStep();
  return (
    <div aria-live="polite">
      <div className={styles.ended}>
        <p className={styles.endedText}>
          If {device} isn’t yours, sign it out of your account.
        </p>
        <div className={styles.requestActions}>
          <Button size="sm" variant="quiet" onClick={() => api.dismissLinkApproval()}>
            OK
          </Button>
          <Button
            size="sm"
            disabled={step.busy}
            onClick={() => step.run(() => api.signOutTurnedDown())}
          >
            Sign it out
          </Button>
        </div>
      </div>
      <Problem text={step.problem} />
    </div>
  );
}

/**
 * With sync on: other devices asking to link, and approving one. The account key is sealed for
 * the new device only once the person says both screens show the same emoji, and only while
 * it's the one device asking.
 */
export function RequestsPanel({
  api,
  approvals,
}: {
  api: FactwrightApi;
  approvals: ApprovalsView;
}) {
  const { requests, approving, turnedDown } = approvals;
  const step = useStep();
  if (requests.length === 0 && !approving && !turnedDown) return null;

  const ended = approving?.step === 'ended';
  // While approving, the requests listed are the others: another device asked meanwhile.
  const others = approving
    ? requests.filter((request) => !request.elsewhere && request.id !== approving.id)
    : [];
  return (
    <section
      className={`${styles.requests} ${ended ? (approving.linked ? styles.requestsLinked : styles.requestsOver) : ''} ${!approving && requests.length === 0 ? styles.requestsOver : ''}`}
      aria-labelledby="sync-requests"
    >
      <h3 id="sync-requests" className={styles.heading}>
        {approving?.step === 'ended'
          ? approving.linked
            ? 'Linked'
            : 'Not linked'
          : approving
            ? `Approve ${approving.device}?`
            : requests.length === 0
              ? 'Turned down'
              : requests.length === 1
                ? 'A new device wants to link'
                : 'New devices want to link'}
      </h3>

      {approving?.step === 'waiting' && (
        <p className={styles.waiting} aria-live="polite">
          <span className={`${styles.dot} ${styles.dotSyncing}`} aria-hidden="true" />
          Waiting for {approving.device}…
        </p>
      )}

      {approving?.step === 'check' && (
        <div aria-live="polite">
          <p className={styles.approveText}>
            Check <strong>{approving.device}</strong> shows the same emoji, in the same order:
          </p>
          <CheckCode items={checkEmoji(approving.check)} />
          <p className={styles.hint}>
            Only link a device that’s in front of you: it gets your whole job hunt. Nobody from
            Factwright will ever ask you for these emoji.
          </p>
          {others.length > 0 && (
            <div className={styles.crowded} role="alert">
              <p>
                Another device asked to link while you were checking this one. Turn down any that
                aren’t yours before you link.
              </p>
              <ul className={styles.requestList}>
                {others.map((request) => (
                  <Request key={request.id} api={api} request={request} approve="no" />
                ))}
              </ul>
            </div>
          )}
          <Problem text={step.problem} />
          <div className={styles.approveActions}>
            <Button
              disabled={step.busy}
              onClick={() => step.run(() => api.answerLinkRequest(false))}
            >
              They don’t match
            </Button>
            <Button
              variant="primary"
              disabled={step.busy || others.length > 0}
              onClick={() => step.run(() => api.answerLinkRequest(true))}
            >
              They match, link it
            </Button>
          </div>
        </div>
      )}

      {approving?.step === 'sent' && (
        <p className={styles.waiting} aria-live="polite">
          <span className={`${styles.dot} ${styles.dotSyncing}`} aria-hidden="true" />
          Approved. {approving.device} links once you say they match there too.
        </p>
      )}

      {approving?.step === 'ended' && (
        <div className={styles.ended} aria-live="polite">
          <p className={approving.linked ? styles.linked : styles.endedText}>
            {approving.linked && <CircleCheck size={16} aria-hidden="true" />}
            {approving.message}
          </p>
          <Button size="sm" onClick={() => api.dismissLinkApproval()}>
            OK
          </Button>
        </div>
      )}

      {!approving && turnedDown && <TurnedDown api={api} device={turnedDown.device} />}

      {!approving && requests.length > 0 && (
        <>
          <ul className={styles.requestList}>
            {requests.map((request) => (
              <Request
                key={request.id}
                api={api}
                request={request}
                approve={requests.length > 1 ? 'not-while-crowded' : 'yes'}
              />
            ))}
          </ul>
          <p className={styles.hint}>
            {requests.length > 1
              ? 'More than one device is asking. Turn down any that aren’t yours, then approve yours.'
              : 'Don’t recognize it? Turn it down, then sign it out.'}
          </p>
        </>
      )}
    </section>
  );
}
