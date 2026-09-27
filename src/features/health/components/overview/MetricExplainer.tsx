import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { TonePill, ToneDot, cx } from '../../../../shared/ui'
import {
  BENCHMARKS, type BenchmarkContext, type BenchmarkMetric, type Classification, type Source,
} from '../../benchmarks/healthBenchmarks'
import { HEALTH_DISCLAIMER } from '../../benchmarks/healthGuidance'
import { referenceLadder } from '../../benchmarks/referenceLadder'

// The science block of a detail sheet: where the value sits, the whole
// reference ladder (built from classify itself, so it can't disagree with the
// band), what the metric means, how to move it, the caveats and the sources.

function dedupeSources(lists: Source[][]): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const s of lists.flat()) if (!seen.has(s.url)) { seen.add(s.url); out.push(s) }
  return out
}

export function ReferenceLadder({ metric, ctx, value }: { metric: BenchmarkMetric; ctx: BenchmarkContext; value: number | null }) {
  const steps = referenceLadder(metric, ctx, value)
  if (steps.length < 2) return null
  const unit = BENCHMARKS[metric].unit
  return (
    <div>
      <p className="section-label mb-1.5">Reference ladder <span className="normal-case tracking-normal text-fg-faint">({unit})</span></p>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={`${s.band}-${i}`}
            className={cx('flex min-h-[36px] items-center gap-2 rounded-row px-2.5 py-1.5 text-meta',
              s.current ? 'bg-surface-2 ring-1 ring-line-strong' : '')}>
            <ToneDot tone={s.tone} />
            <span className={cx('min-w-0 flex-1', s.current ? 'font-semibold text-fg' : 'text-fg-2')}>{s.label}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">{s.range}</span>
            {s.current && <span className="shrink-0 text-micro font-semibold text-fg">you</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
        <ChevronDown aria-hidden className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1.5">
          {sources.map(s => (
            <li key={s.url} className="text-micro font-normal leading-snug text-fg-muted">
              <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-fg">
                {s.citation}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MetricExplainer({ metric, ctx, value, cls, extraSources = [] }: {
  metric: BenchmarkMetric
  ctx: BenchmarkContext
  value: number | null
  cls: Classification | null
  extraSources?: Source[]
}) {
  const info = BENCHMARKS[metric]
  return (
    <div className="flex flex-col gap-4">
      {cls && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <TonePill tone={cls.tone}>{cls.label}</TonePill>
            {cls.percentile != null && <span className="text-meta text-fg-muted">about the {cls.percentile}th percentile</span>}
          </div>
          <p className="text-meta text-fg-2">{cls.referenceText}</p>
          <p className="text-meta text-fg-muted">{cls.meaning}</p>
          {cls.nextStep && (
            <p className="text-meta text-fg-2">
              <span className="font-semibold text-fg">Next step:</span> {cls.nextStep.label} — {cls.nextStep.gap.toLocaleString('en-GB')} {info.unit} to go.
            </p>
          )}
        </div>
      )}
      <ReferenceLadder metric={metric} ctx={ctx} value={value} />
      <div className="flex flex-col gap-3 text-meta leading-relaxed">
        <div><p className="section-label mb-0.5">What it means</p><p className="text-fg-2">{info.whatItMeans}</p></div>
        <div><p className="section-label mb-0.5">How to improve it</p><p className="text-fg-2">{info.howToImprove}</p></div>
        <div><p className="section-label mb-0.5">Read it with care</p><p className="text-fg-muted">{info.caveats}</p></div>
      </div>
      <SourceList sources={dedupeSources([cls?.sources ?? [], info.sources, extraSources])} />
      <p className="text-micro font-normal text-fg-faint">{HEALTH_DISCLAIMER}</p>
    </div>
  )
}
