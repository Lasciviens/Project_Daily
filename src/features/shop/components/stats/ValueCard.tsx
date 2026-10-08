import { boughtOn, DISPOSAL_LABEL, durationLabel } from '../../ownModel'
import { valueEnds, type ValueRow } from '../../statsModel'
import { StatsCard } from './statsKit'
import { num } from './statsFormat'
import { join, type DrillRow } from './drillTypes'
import { DrillRowButton } from './StatsDrillSheet'

/**
 * Value for money: cost of use per month — what a thing cost, less what came
 * back or it could sell for, per month you had it — the dearest five and the
 * cheapest five. Only things with an honest number are ranked.
 */
export function ValueCard({ rows, today, onOpen }: { rows: ValueRow[]; today: string; onOpen: (id: string) => void }) {
  const { dearest, cheapest } = valueEnds(rows, 5)
  const row = ({ item: i, per }: ValueRow): DrillRow => ({
    key: i.id, id: i.id, title: i.title, text: `≈ ${num(per.nok)} NOK/month`,
    sub: join([durationLabel(boughtOn(i) as string, i.disposed_on ?? today), i.disposal ? DISPOSAL_LABEL[i.disposal] : 'still yours']),
  })
  return (
    <StatsCard title="Cost of use per month" subtitle="Cost, less what came back or it could sell for, per month you had it">
      {rows.length === 0
        ? <p className="text-body text-fg-muted">Set &quot;Could sell for&quot; on what you own — or sell something — to see what each thing costs you per month.</p>
        : (
          <div className="flex flex-col gap-3">
            <List title={cheapest.length ? 'Dearest' : null} rows={dearest.map(row)} onOpen={onOpen} />
            {cheapest.length > 0 && <List title="Cheapest" rows={cheapest.map(row)} onOpen={onOpen} />}
          </div>
        )}
    </StatsCard>
  )
}

function List({ title, rows, onOpen }: { title: string | null; rows: DrillRow[]; onOpen: (id: string) => void }) {
  return (
    <section aria-label={title ?? undefined}>
      {title && <h4 className="section-label pb-0.5">{title}</h4>}
      <ul className="-mx-3 flex flex-col">
        {rows.map(r => <li key={r.key}><DrillRowButton row={r} onOpen={() => onOpen(r.id)} /></li>)}
      </ul>
    </section>
  )
}
