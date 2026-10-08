import type { ResaleSummary } from '../../statsModel'
import { StatsCard } from './statsKit'
import { resaleDrill } from './statsDrillOwned'
import type { StatsData } from './drillTypes'
import { DrillRowButton } from './StatsDrillSheet'
import { nestAccessories } from './drillNest'

/** Things bought to sell later (shown only when there are some): the result, and each one's. */
export function ResaleCard({ summary, data, onOpen }: { summary: ResaleSummary | null; data: StatsData; onOpen: (id: string) => void }) {
  if (!summary) return null
  const content = resaleDrill(data)
  return (
    <StatsCard title="Bought to sell" subtitle={content.subtitle}>
      <ul className="-mx-3 flex flex-col">
        {nestAccessories(content.groups.flatMap(g => g.rows), data.byId).map(r => <li key={r.key}><DrillRowButton row={r} onOpen={() => onOpen(r.id)} /></li>)}
      </ul>
    </StatsCard>
  )
}
