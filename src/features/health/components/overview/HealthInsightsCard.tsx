import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { Button, Card, CardHeader, ToneDot } from '../../../../shared/ui'
import { buildHealthInsights, type Insight } from '../../benchmarks/healthGuidance'
import { insightInput } from './insightInput'
import type { HealthHero } from './useHealthHero'
import { SourceList } from './MetricExplainer'

// Plain-language insights from the hero's numbers (healthGuidance.ts —
// deterministic, association-not-diagnosis wording). Needs-attention first.

const SHOW = 4

function InsightRow({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex gap-2.5 py-2.5 @[44rem]:border-t @[44rem]:border-line">
      <ToneDot tone={insight.tone} className="mt-1.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body font-semibold text-fg">{insight.title}</p>
        <p className="text-meta text-fg-2">{insight.text}</p>
        {insight.action && <p className="text-meta text-fg"><span className="font-semibold">Try:</span> {insight.action}</p>}
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="btn-ghost btn-sm -ml-2 self-start px-2 text-meta">
          {open ? 'Hide why' : 'Why?'}
        </button>
        {open && (
          <div className="flex flex-col gap-1">
            <p className="text-meta text-fg-muted">{insight.why}</p>
            <SourceList sources={insight.sources} />
          </div>
        )}
      </div>
    </li>
  )
}

export function HealthInsightsCard({ hero }: { hero: HealthHero }) {
  const [all, setAll] = useState(false)
  const insights = buildHealthInsights(insightInput(hero))
  if (!insights.length) return null
  const shown = all ? insights : insights.slice(0, SHOW)
  return (
    // Two columns of insights once the card is wide (it spans two tracks on a big monitor), so lines stay short.
    <Card className="@container w-full max-w-4xl">
      <CardHeader wrap icon={<Lightbulb />} title="What your numbers say" subtitle="Population evidence — associations, not a diagnosis" />
      <ul className="-my-1 divide-y divide-line @[44rem]:grid @[44rem]:grid-cols-2 @[44rem]:gap-x-6 @[44rem]:divide-y-0">
        {shown.map(i => <InsightRow key={i.id} insight={i} />)}
      </ul>
      {insights.length > SHOW && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${insights.length}`}
        </Button>
      )}
    </Card>
  )
}
