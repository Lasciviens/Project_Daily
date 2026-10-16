import { useState } from 'react'
import { AlarmClock, Check, SkipForward } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, MetaLine, SkeletonText, Truncate } from '../../../shared/ui'
import { Time24Field } from '../../../shared/components/plan-modal/fields'
import { shiftTime } from '../../../shared/components/plan-modal/planModal.config'
import { formatTime, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { useSkipDose, useSnoozeDose, useSupplementDoses, useTakeDoses } from '../hooks/useSupplements'
import { doseWhen, minutesOf, type Dose, type LocalNow } from '../supplementDoses'

const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const roundDown5 = (m: number) => m - (m % 5)

/**
 * `supplement-dose`: the dose sheet a reminder's tap opens (iOS shows no
 * buttons on a web push) — Taken now · Taken at… · Skip today · Snooze 1 h.
 * Without a schedule: every dose of the day still open, with Take all.
 */
export function SupplementDoseEntityModal({ request, onClose }: EntityModalProps<'supplement-dose'>) {
  const { doses, now, isLoading } = useSupplementDoses(request.date)
  const [handled] = useState(() => new Set<string>())
  const one = request.scheduleId
    ? doses.filter(d => d.scheduleId === request.scheduleId && (!request.time || d.time === request.time))
    : null
  const open = doses.filter(d => d.status === 'due' || d.status === 'missed' || handled.has(d.key))

  if (isLoading && doses.length === 0) {
    return <ModalShell onClose={onClose} title="Supplements" size="sm"><SkeletonText lines={3} /></ModalShell>
  }
  if (one && one.length === 1) return <OneDose dose={one[0]} now={now} onClose={onClose} />
  const list = one && one.length > 1 ? one : open
  return <DueDoses doses={list} date={request.date} now={now} handled={handled} onClose={onClose} />
}

function OneDose({ dose, now, onClose }: { dose: Dose; now: LocalNow; onClose: () => void }) {
  const take = useTakeDoses()
  const skip = useSkipDose()
  const snooze = useSnoozeDose()
  const today = dose.date === now.date
  // "Taken earlier" starts at the dose's own time (or now, for one not due yet).
  const [at, setAt] = useState(() => (today && minutesOf(dose.time) > now.minutes ? hm(roundDown5(now.minutes)) : dose.time))
  const busy = take.isPending || skip.isPending || snooze.isPending
  const run = (p: Promise<unknown>) => { void p.then(onClose, () => undefined) }
  const openDose = dose.status === 'due' || dose.status === 'missed' || dose.status === 'upcoming'

  return (
    <ModalShell onClose={onClose} size="sm" dismissible={!busy}
      title={`${dose.title} ${dose.label}`}
      subtitle={<MetaLine as="span" items={[dose.time, today ? 'today' : formatWeekdayDate(dose.date), doseWhen(dose, now)]} />}>
      {!openDose ? (
        <p className="text-body text-fg-2">
          {dose.status === 'taken' ? `Taken${dose.takenAt ? ` at ${formatTime(dose.takenAt)}` : ''} — nothing more to do.`
            : dose.status === 'skipped' ? 'Skipped for this day.' : 'Nothing to do for this dose.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Button variant="primary" icon={<Check />} block disabled={busy}
            onClick={() => run(take.mutateAsync({ doses: [dose] }))}>
            {today ? 'Taken now' : `Taken at its time (${dose.time})`}
          </Button>
          <div className="flex flex-col gap-1.5 rounded-control border border-line p-2.5">
            <span className="text-meta text-fg-muted">Taken earlier</span>
            <div className="flex flex-wrap items-center gap-2">
              <Time24Field size="sm" value={at} onChange={setAt} onShift={d => setAt(shiftTime(at, d))} />
              <Button size="sm" disabled={busy || (today && minutesOf(at) > now.minutes)} onClick={() => run(take.mutateAsync({ doses: [dose], at }))}>
                Taken at {at}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<SkipForward />} disabled={busy} onClick={() => run(skip.mutateAsync(dose))}>
              {today ? 'Skip today' : 'Skip'}
            </Button>
            {dose.status === 'due' && (
              <Button size="sm" variant="ghost" icon={<AlarmClock />} disabled={busy} onClick={() => run(snooze.mutateAsync({ dose }))}>
                Snooze 1 h
              </Button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  )
}

function DueDoses({ doses, date, now, handled, onClose }: {
  doses: readonly Dose[]
  date: string
  now: LocalNow
  /** Doses handled in this sheet stay listed (as taken / skipped) until it closes. */
  handled: Set<string>
  onClose: () => void
}) {
  const take = useTakeDoses()
  const skip = useSkipDose()
  const snooze = useSnoozeDose()
  const busy = take.isPending || skip.isPending || snooze.isPending
  const left = doses.filter(d => d.status === 'due' || d.status === 'missed')
  const mark = (d: Dose) => handled.add(d.key)

  const footer = left.length > 1 ? (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">Close</Button>
      <Button variant="primary" size="sm" icon={<Check />} disabled={busy}
        onClick={() => { left.forEach(mark); void take.mutateAsync({ doses: left }).then(onClose, () => undefined) }}>
        Take all ({left.length})
      </Button>
    </div>
  ) : undefined

  return (
    <ModalShell onClose={onClose} size="sm" title="Supplements" footer={footer}
      subtitle={date === now.date ? 'Not taken yet today' : formatWeekdayDate(date)}>
      {doses.length === 0 ? (
        <p className="text-body text-fg-2">Nothing open — every dose of this day is taken or skipped.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {doses.map(d => {
            const isOpen = d.status === 'due' || d.status === 'missed'
            return (
              <li key={d.key} className="flex items-center gap-1.5 px-1 py-1.5">
                <div className="min-w-0 flex-1">
                  <Truncate className="text-body text-fg" fullText={`${d.title} ${d.label}`}>{d.title} <span className="text-fg-muted">{d.label}</span></Truncate>
                  <MetaLine className="text-meta tabular-nums text-fg-muted" items={[d.time, doseWhen(d, now)]} />
                </div>
                {isOpen && (
                  <>
                    <Button size="sm" icon={<Check />} disabled={busy} onClick={() => { mark(d); take.mutate({ doses: [d] }) }} className="!px-2.5">Take</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { mark(d); skip.mutate(d) }} className="!px-2 text-fg-muted">Skip</Button>
                    {d.status === 'due' && (
                      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Snooze ${d.title} 1 h`} onClick={() => { mark(d); snooze.mutate({ dose: d }) }}
                        className="!px-2 text-fg-muted"><AlarmClock aria-hidden className="h-4 w-4" /></Button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </ModalShell>
  )
}
