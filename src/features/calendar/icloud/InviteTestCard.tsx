import { useState } from 'react'
import { MailPlus, Repeat, ScanSearch, Send, Trash2, UserMinus } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, TonePill, Truncate, type Tone } from '../../../shared/ui'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { InvitePartstat, InviteTestGuest, InviteTestState } from './inviteTestApi'
import { useCheckInviteTest, useDeleteInviteTest, useInviteTestState, useRemoveInviteGuest, useRewriteInviteTest, useSendInviteTest } from './useInviteTest'

// Settings → Subscriptions → Invite test (25.11.2026): a one-off live test of Apple Calendar invitations before the
// real feature — shown only while iCloud is connected. Send makes ONE event ("Invite test", tomorrow 12:00–12:30, the
// Personal calendar) with the owner as organizer and 1–2 guests, and iCloud emails them; Check reads each guest's
// answer back; Rewrite writes the same event again (does a second invitation go out?); Remove guest (a cancellation?);
// Delete. Everything that can email someone asks first. docs/integrations/icloud-caldav.md → The invite test.

const ANSWER: Record<InvitePartstat, { label: string; tone: Tone }> = {
  'ACCEPTED':     { label: 'Yes', tone: 'success' },
  'TENTATIVE':    { label: 'Maybe', tone: 'warn' },
  'DECLINED':     { label: 'No', tone: 'danger' },
  'NEEDS-ACTION': { label: 'No answer', tone: 'neutral' },
  'OTHER':        { label: 'Other', tone: 'neutral' },
}

/** iCloud's delivery codes (RFC 6638 SCHEDULE-STATUS, RFC 5546 §3.6), in plain words. */
const DELIVERY: Record<string, string> = {
  '1.0': 'pending', '1.1': 'sent', '1.2': 'delivered', '2.0': 'done', '3.7': 'unknown address', '3.8': 'not allowed',
  '5.1': 'not delivered', '5.2': 'refused', '5.3': 'not supported',
}

const listOf = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? ''

function GuestRow({ guest, onRemove, busy }: { guest: InviteTestGuest; onRemove: (email: string) => void; busy: boolean }) {
  const answer = ANSWER[guest.partstat]
  const code = guest.scheduleStatus?.split(',')[0] ?? null
  return (
    <li className="flex min-w-0 items-center gap-2 py-1.5">
      <Truncate className="min-w-0 flex-1 text-body text-fg">{guest.email ?? 'An address the test doesn\'t take'}</Truncate>
      <span title={`PARTSTAT ${guest.partstat}`} className="shrink-0"><TonePill tone={answer.tone}>{answer.label}</TonePill></span>
      {code && <span title={`SCHEDULE-STATUS ${guest.scheduleStatus}`} className="shrink-0 text-meta tabular-nums text-fg-muted">{code}{DELIVERY[code] ? ` ${DELIVERY[code]}` : ''}</span>}
      {guest.email && (
        <IconButton size="sm" label="Remove this guest — iCloud emails a cancellation" disabled={busy} onClick={() => onRemove(guest.email!)}>
          <UserMinus />
        </IconButton>
      )}
    </li>
  )
}

function Fact({ name, value }: { name: string; value: string | number | null }) {
  return (
    <>
      <dt className="text-fg-muted">{name}</dt>
      <dd className="min-w-0"><Truncate className="text-fg-2 tabular-nums">{value === null ? '—' : String(value)}</Truncate></dd>
    </>
  )
}

function InviteTestResult({ state, onRemove, busy }: { state: InviteTestState; onRemove: (email: string) => void; busy: boolean }) {
  return (
    <div className="mt-3 flex max-w-xl flex-col gap-2">
      {!state.exists ? <p className="text-meta text-fg-2">No test event in Apple Calendar.</p>
        : !state.ours ? <p role="alert" className="text-meta text-warn">Something else is at the test event's place — the app leaves it alone.</p>
          : (
            <>
              <p className="section-label">Invite test · {state.day ? `${formatDate(state.day)} 12:00–12:30` : 'moved in Apple Calendar'}</p>
              <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
                <Fact name="Organizer" value={state.organizer} />
                <Fact name="Sequence" value={state.sequence} />
                <Fact name="ETag" value={state.etag} />
                <Fact name="Schedule-Tag" value={state.scheduleTag} />
              </dl>
              {state.guests.length
                ? <ul className="flex flex-col divide-y divide-line">{state.guests.map((g, i) => <GuestRow key={g.email ?? i} guest={g} onRemove={onRemove} busy={busy} />)}</ul>
                : <p className="text-meta text-fg-2">No guests — a plain event now.</p>}
            </>
          )}
      <p className="text-meta text-fg-muted">{state.used} of {state.cap} Send, Rewrite and Remove today</p>
    </div>
  )
}

export function InviteTestCard() {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const state = useInviteTestState().data ?? null
  const check = useCheckInviteTest()
  const send = useSendInviteTest()
  const rewrite = useRewriteInviteTest()
  const remove = useRemoveInviteGuest()
  const del = useDeleteInviteTest()
  const busy = check.isPending || send.isPending || rewrite.isPending || remove.isPending || del.isPending
  const addresses = [first, second].map(s => s.trim()).filter(Boolean)
  const known = (state?.guests ?? []).map(g => g.email).filter((e): e is string => !!e)

  async function sendIt() {
    if (!addresses.length || busy) return
    const ok = await entityModal.confirm({
      title: 'Send the invite test?',
      message: `Email an invitation to ${listOf(addresses)} in your name? iCloud sends it, with you as the organizer. This can't be undone.`,
      confirmLabel: 'Send',
    })
    if (ok) send.mutate(addresses, { onSuccess: () => { setFirst(''); setSecond('') } })
  }

  async function rewriteIt() {
    const ok = await entityModal.confirm({
      title: 'Rewrite the test event?',
      message: `The same event is written again, with each guest's answer and the sequence as iCloud has them. If iCloud counts it as a change, it emails ${known.length ? listOf(known) : 'the guests'} again in your name. This can't be undone.`,
      confirmLabel: 'Rewrite',
    })
    if (ok) rewrite.mutate()
  }

  async function removeGuest(email: string) {
    const ok = await entityModal.confirm({
      title: 'Remove this guest?',
      message: `Email ${email} a cancellation in your name? They come off the test event. This can't be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (ok) remove.mutate(email)
  }

  async function deleteIt() {
    const ok = await entityModal.confirm({
      title: 'Delete the test event?',
      message: `It goes from your Personal calendar on every device${known.length ? `, and iCloud emails ${listOf(known)} a cancellation in your name` : ' — if it still has guests, iCloud emails them a cancellation in your name'}. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) del.mutate()
  }

  return (
    <Card aria-label="Invite test">
      <CardHeader icon={<MailPlus />} title="Invite test" subtitle="One-off test · Apple Calendar invitations" />
      <p className="text-meta text-fg-2">
        A one-off test before invitations are built: Send makes one event, “Invite test”, tomorrow 12:00–12:30 in your Personal
        calendar, with you as the organizer — iCloud emails each guest an invitation in your name. Delete it when the test is done.
      </p>
      <form className="mt-3 flex max-w-md flex-col gap-2" onSubmit={e => { e.preventDefault(); void sendIt() }}>
        <input className="input" type="email" inputMode="email" autoComplete="off" spellCheck={false} placeholder="Guest email" aria-label="Guest email"
          value={first} onChange={e => setFirst(e.target.value)} />
        <div className="flex items-center gap-2">
          <input className="input min-w-0 flex-1" type="email" inputMode="email" autoComplete="off" spellCheck={false} placeholder="Second guest (optional)" aria-label="Second guest email (optional)"
            value={second} onChange={e => setSecond(e.target.value)} />
          <Button type="submit" variant="primary" icon={<Send />} loading={send.isPending} disabled={!addresses.length || busy} tip="Send the invitation from your iCloud address">Send</Button>
        </div>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<ScanSearch />} loading={check.isPending} disabled={busy} onClick={() => check.mutate()} tip="Check each guest's answer in iCloud">Check</Button>
        <Button size="sm" icon={<Repeat />} loading={rewrite.isPending} disabled={busy} onClick={() => void rewriteIt()} tip="Rewrite the same event again (does a second invitation go out?)">Rewrite</Button>
        <Button size="sm" icon={<Trash2 />} loading={del.isPending} disabled={busy} onClick={() => void deleteIt()} tip="Delete the test event">Delete</Button>
      </div>
      {state && <InviteTestResult state={state} onRemove={email => void removeGuest(email)} busy={busy} />}
    </Card>
  )
}
