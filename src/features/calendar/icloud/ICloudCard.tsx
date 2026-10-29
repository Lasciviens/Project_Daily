import { useState } from 'react'
import { Apple, Check, RefreshCw, Trash2, Unplug, X } from 'lucide-react'
import { Button, ToneDot, TonePill } from '../../../shared/ui'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { ConnectionCard } from '../../developer/components/ConnectionCard'
import type { ICloudChanges, ICloudCheck } from './icloudApi'
import { useConnectICloud, useDisconnectICloud, useICloudChanges, useICloudStatus, useRemoveICloudTest, useRunICloudCheck } from './useICloud'

// Settings → Subscriptions → Apple Calendar (iCloud), Phase 1 (owner,
// 29.10.2026: "I have to be sure that iCloud Calendar would work as good as
// Google Calendar"). Connect with an app-specific password, then the Apple
// check: test events in "Lasci · Test", what iCloud kept, and what to look for
// on the iPhone and Mac. docs/integrations/icloud-caldav.md.

const KEPT_LABEL: Record<string, string> = {
  summary: 'title', alarm: 'alert', description: 'notes', url: 'link', location: 'place', pin: 'map pin',
  travel: 'Time to Leave', tentative: 'Maybe', private: 'private', free: 'Free', allDay: 'all day', rrule: 'repeat', exdate: 'day left out',
}

/** What the owner checks on the iPhone and Mac for each test event. */
function lookFor(key: string, day: string): string {
  const d = (n: number) => formatDate(shiftDateStr(day, n))
  switch (key) {
    case 'alarm': return 'One alert 10 minutes before (not two)'
    case 'notes': return 'Notes on three lines; the link opens the app'
    case 'place': return 'A map with a pin at Oslo S; "Time to Leave" may be offered'
    case 'maybe': return 'Shown as Maybe (tentative)'
    case 'private': return 'Marked private'
    case 'free': return 'Shown as Free'
    case 'allday': return 'At the top of the day, all day'
    case 'repeat': return `At 18:00 on ${d(0)}, ${d(2)} and ${d(3)} — not on ${d(1)}`
    case 'emoji': return 'The 🏋️ and æøå look right'
    default: return ''
  }
}

function ConnectForm() {
  const [appleId, setAppleId] = useState('')
  const [password, setPassword] = useState('')
  const connect = useConnectICloud()
  return (
    <form className="flex max-w-md flex-col gap-2" onSubmit={e => {
      e.preventDefault()
      if (connect.isPending) return
      connect.mutate({ appleId, appPassword: password }, { onSuccess: () => setPassword('') })
    }}>
      <ol className="list-inside list-decimal space-y-0.5 text-meta text-fg-2">
        <li>At <a href="https://account.apple.com" target="_blank" rel="noreferrer" className="text-accent-600 underline">account.apple.com</a>: Sign-In and Security → App-Specific Passwords → make one called "Lasci's Board".</li>
        <li>Enter your Apple ID email and that password here — never your Apple ID password.</li>
      </ol>
      <input className="input" type="email" autoComplete="username" placeholder="Apple ID email" value={appleId} onChange={e => setAppleId(e.target.value)} />
      <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="App-specific password (abcd-efgh-ijkl-mnop)" value={password} onChange={e => setPassword(e.target.value)} />
      <div>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!appleId.trim() || !password.trim()}>Connect iCloud</Button>
      </div>
      <p className="text-meta text-fg-muted">Only the server keeps the password (never this browser), and it is used only for your calendars. Revoke it any time at account.apple.com.</p>
    </form>
  )
}

function CheckResult({ result }: { result: ICloudCheck }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {result.steps.map(s => (
          <li key={s.step} className="flex items-start gap-2 text-meta">
            <ToneDot tone={s.ok ? 'success' : 'danger'} className="mt-1.5" />
            <span className="min-w-0"><span className="font-semibold text-fg">{s.step}</span> <span className="text-fg-2">· {s.detail}</span></span>
          </li>
        ))}
      </ul>
      {result.message && <p className="text-meta text-fg-2">{result.message}</p>}
      {result.events && result.day && (
        <div>
          <p className="section-label">On your iPhone and Mac — "{result.calendar}" (purple), {formatDate(result.day)}</p>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {result.events.map(e => (
              <li key={e.key} className="flex flex-col gap-1 py-2">
                <span className="text-body font-semibold text-fg">{e.label}</span>
                <span className="text-meta text-fg-2">{lookFor(e.key, result.day!)}</span>
                <span className="flex flex-wrap gap-1">
                  {!e.written && <TonePill tone="danger">iCloud refused it ({e.status})</TonePill>}
                  {e.kept && Object.entries(e.kept).filter(([k]) => k !== 'summary').map(([k, ok]) => (
                    <TonePill key={k} tone={ok ? 'success' : 'warn'} className="[&_svg]:h-3 [&_svg]:w-3">
                      {ok ? <Check aria-label="kept" /> : <X aria-label="lost" />} {KEPT_LABEL[k] ?? k}
                    </TonePill>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ChangesResult({ result }: { result: ICloudChanges }) {
  if (!result.tokenWorked) return <p className="mt-2 text-meta text-fg-2">{result.message}</p>
  if (!result.changes.length) return <p className="mt-2 text-meta text-fg-2">No changes yet — move or rename a test event on your iPhone, wait a moment, then check again.</p>
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {result.changes.map((c, i) => (
        <li key={i} className="text-meta text-fg-2"><span className="font-semibold text-fg">{c.kind === 'removed' ? 'Removed' : 'Changed'}</span> · {c.title} · {c.starts}</li>
      ))}
    </ul>
  )
}

export function ICloudCard() {
  const status = useICloudStatus()
  const disconnect = useDisconnectICloud()
  const check = useRunICloudCheck()
  const changes = useICloudChanges()
  const remove = useRemoveICloudTest()
  const s = status.data
  const connected = !!s?.connected
  // The last check stays on the server: the list survives the trip to the Calendar app.
  const result = check.data ?? s?.lastCheck ?? null
  const hasTest = !!(s?.hasTest || check.data)

  async function runCheck() {
    if (result?.events) {
      const ok = await entityModal.confirm({
        title: 'Run the Apple check again?',
        message: 'The test events are written again, over anything you moved, and "Check changes" starts over from now. Check changes first if you moved an event.',
        confirmLabel: 'Run again',
      })
      if (!ok) return
    }
    changes.reset()
    check.mutate()
  }

  async function removeTest() {
    const ok = await entityModal.confirm({
      title: s?.testIsApps === false ? 'Remove the test events?' : 'Remove the test calendar?',
      message: s?.testIsApps === false
        ? `The check's events go from "${result?.calendar ?? 'your test calendar'}" in iCloud, on every device; the calendar itself stays. This can't be undone.`
        : '"Lasci · Test" and its events go from iCloud, on every device. This can\'t be undone.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (ok) remove.mutate(undefined, { onSuccess: () => { check.reset(); changes.reset() } })
  }

  async function disconnectICloud() {
    const ok = await entityModal.confirm({
      title: 'Disconnect iCloud?',
      message: `The app forgets the app-specific password (Apple shows a password only once — connecting again takes a new one).${hasTest ? ' The test calendar stays in iCloud: remove it first if you\'re done with it.' : ''} Then revoke the password at account.apple.com. This can't be undone.`,
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (ok) disconnect.mutate(undefined, { onSuccess: () => { check.reset(); changes.reset() } })
  }

  return (
    <ConnectionCard service="icloud" kind="user" icon={<Apple />} name="Apple Calendar (iCloud)" account={s?.appleId}
      description="Writes straight into Apple Calendar through iCloud — Phase 1 is a check: a few test events, then you look at your iPhone and Mac."
      status={status.isLoading || status.isError ? 'unknown' : connected ? 'connected' : 'disconnected'}
      details={[s?.connectedAt ? `Since ${formatDateTime(s.connectedAt)}` : null]}>
      {status.isLoading ? null : status.isError ? (
        // Never the Connect form on a failed read: Apple shows a password only once.
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-meta text-danger">{status.error instanceof Error ? status.error.message : 'The iCloud connection could not be read'}</p>
          <Button size="sm" onClick={() => status.refetch()}>Retry</Button>
        </div>
      ) : !connected ? <ConnectForm /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={runCheck} loading={check.isPending}>{result?.events ? 'Run the check again' : 'Run the Apple check'}</Button>
            {hasTest && (
              <Button size="sm" icon={<RefreshCw />} onClick={() => changes.mutate()} loading={changes.isPending}>Check changes</Button>
            )}
            {hasTest && (
              <Button size="sm" icon={<Trash2 />} onClick={removeTest} loading={remove.isPending}>{s?.testIsApps === false ? 'Remove test events' : 'Remove test calendar'}</Button>
            )}
            <Button size="sm" icon={<Unplug />} onClick={disconnectICloud} loading={disconnect.isPending}>Disconnect</Button>
          </div>
          {s?.lastError && <p role="alert" className="mt-2 text-meta text-danger">Last problem: {s.lastError}</p>}
          {changes.data && <ChangesResult result={changes.data} />}
          {result && <CheckResult result={result} />}
        </>
      )}
    </ConnectionCard>
  )
}
