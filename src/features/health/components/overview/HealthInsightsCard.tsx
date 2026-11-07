import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb } from 'lucide-react'
import { Button, Card, CardHeader, Skeleton, ToneDot } from '../../../../shared/ui'
import { buildHealthInsights, type Insight } from '../../benchmarks/healthGuidance'
import { insightInput } from './insightInput'
import type { HealthHero } from './useHealthHero'
import { SourceList } from './MetricExplainer'
import { useMuscleWatch } from '../../goal/useMuscleWatch'
import { GOAL_SRC } from '../../goal/goalSources'

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
        {insight.href && (
          <Link to={insight.href} className="btn-ghost btn-sm -ml-2 self-start px-2 text-meta font-semibold text-accent-600">Open Goal progress</Link>
        )}
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
  const { watch, isLoading: watchLoading } = useMuscleWatch()
  // The list waits for every reading it is worked out from: built as each one came, new insights landed
  // between the ones already shown and moved them (a layout shift). The card isn't drawn before then.
  const loading = watchLoading || [hero.sleep, hero.steps, hero.exercise, hero.rhr, hero.weight, hero.vitals].some(m => m.isLoading)
  const insights = buildHealthInsights({
    ...insightInput(hero),
    muscleWatch: watch && { level: watch.level, headline: watch.headline, actions: watch.actions, sources: [GOAL_SRC.looney2024, GOAL_SRC.garthe2011, GOAL_SRC.morton2018] },
  })
  if (!loading && !insights.length) return null
  const shown = all ? insights : insights.slice(0, SHOW)
  return (
    // Two columns of insights once the card is wide (it spans two tracks on a big monitor), so lines stay short.
    <Card className="@container w-full max-w-4xl">
      <CardHeader wrap icon={<Lightbulb />} title="What your numbers say" subtitle="Population evidence — associations, not a diagnosis" />
      <ul className="-my-1 divide-y divide-line @[44rem]:grid @[44rem]:grid-cols-2 @[44rem]:gap-x-6 @[44rem]:divide-y-0">
        {loading
          ? Array.from({ length: SHOW }, (_, n) => (
            <li key={n} aria-hidden className="flex flex-col gap-2 py-2.5 pl-[1.125rem] @[44rem]:border-t @[44rem]:border-line">
              <Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" />
            </li>
          ))
          : shown.map(i => <InsightRow key={i.id} insight={i} />)}
      </ul>
      {!loading && insights.length > SHOW && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${insights.length}`}
        </Button>
      )}
    </Card>
  )
}
