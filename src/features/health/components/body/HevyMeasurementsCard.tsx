import { useState } from 'react'
import { Pencil, Plus, Ruler } from 'lucide-react'
import { Button, EmptyState, IconButton, Skeleton } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useEntityModal } from '../../../../shared/modals'
import { useHevyBodyMeasurements } from '../../../training/hooks/useHevyBodyMeasurements'
import { ALL_FIELDS, fmtMeasDate } from '../../../training/bodyMeasurementFields'
import { entryLines, sortedEntries } from '../../hevyMeasurements'
import { signed } from '../overview/heroFormat'
import { SectionCard } from '../sectionKit'
import { HevyMeasurementRow } from './HevyMeasurementRow'

// Health → Body, under the scale: everything typed into Hevy's body
// measurements — weight, body fat and lean mass as Hevy has them plus the tape
// measurements — the whole row, labelled "Logged in Hevy" and never merged
// into the scale charts above. Log / edit open the `body-measurement` popup
// by DATE (moved here from Training → Log → Body). Like the scale charts, it
// follows the page's day: "Latest" is the newest entry on or before the viewed
// day, and anything logged after it is counted, not shown.

const SHOW = 5
const fmt = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2 })

export function HevyMeasurementsCard({ anchor }: { anchor: string }) {
  const modal = useEntityModal()
  const { data = [], isLoading, isError } = useHevyBodyMeasurements()
  const [all, setAll] = useState(false)
  const allRows = sortedEntries(data, ALL_FIELDS)
  const rows = allRows.filter(r => r.date <= anchor)
  const newer = allRows.length - rows.length
  const latest = rows[0]
  const lines = latest ? entryLines(rows, 0, ALL_FIELDS) : []
  const rest = rows.slice(1)
  const shown = all ? rest : rest.slice(0, SHOW)
  const edit = (date: string) => modal.open({ kind: 'body-measurement', date })

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-label flex items-center gap-1">
          Logged in Hevy{allRows.length > 0 && ` · ${allRows.length} ${allRows.length === 1 ? 'entry' : 'entries'}`}
          <InfoBubble label="About the Hevy log">
            What you typed into Hevy&apos;s body measurements: weight, body fat and lean mass as you entered them, plus tape
            measurements. It is kept apart from the smart scale above — a hand-typed weight is a different kind of reading, so it
            never enters the scale charts. Waist here also gives the Overview its waist-to-height check.
          </InfoBubble>
        </p>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => modal.open({ kind: 'body-measurement' })}>
          <span>Log<span className="hidden sm:inline"> measurement</span></span>
        </Button>
      </div>

      {isLoading ? (
        <Skeleton rounded="rounded-row" className="h-24" />
      ) : isError ? (
        <p className="text-meta text-fg-muted">The Hevy measurements couldn’t be loaded.</p>
      ) : !latest ? (
        <EmptyState bordered icon={<Ruler />}
          title={newer > 0 ? `No measurements in Hevy on or before ${fmtMeasDate(anchor)}` : 'No measurements in Hevy yet'}
          description={newer > 0 ? `${newer} ${newer === 1 ? 'entry was' : 'entries were'} logged after this day — move the date forward to see ${newer === 1 ? 'it' : 'them'}.` : 'Log weight, body fat or a tape measurement — it saves to Hevy.'}
          className="py-8" />
      ) : (
        <>
          {newer > 0 && (
            <p className="text-meta text-fg-muted">
              Showing entries up to {fmtMeasDate(anchor)} · {newer} newer {newer === 1 ? 'entry' : 'entries'} after it.
            </p>
          )}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-body font-semibold text-fg-2">Latest · {fmtMeasDate(latest.date)}</p>
              <IconButton label="Edit the latest entry" onClick={() => edit(latest.date)} className="-mr-2"><Pencil /></IconButton>
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {lines.map(l => (
                <li key={l.key} className="rounded-row bg-surface-2 px-3 py-2">
                  <p className="section-label">{l.label}</p>
                  <p className="text-lead font-bold tabular-nums text-fg">{fmt(l.value)} <span className="text-meta font-normal text-fg-muted">{l.unit}</span></p>
                  {/* A change is a fact, not a verdict — no good/bad colour. */}
                  {l.prev && l.delta != null && (
                    <p className="text-micro font-normal tabular-nums text-fg-muted">{signed(l.delta, 1)} since {fmtMeasDate(l.prev.date)}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {rest.length > 0 && (
            <div>
              <p className="section-label mb-1">Earlier entries</p>
              <ul>{shown.map(r => <HevyMeasurementRow key={r.date} row={r} onEdit={() => edit(r.date)} />)}</ul>
              {rest.length > SHOW && (
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAll(a => !a)}>
                  {all ? 'Show fewer' : `Show all ${rest.length}`}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
