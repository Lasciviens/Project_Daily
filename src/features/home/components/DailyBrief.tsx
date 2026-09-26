import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import { Card, SectionLabel, Skeleton, ToneDot, cx } from '../../../shared/ui'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useDailyBrief } from '../hooks/useDailyBrief'
import type { BriefLine } from '../briefRules'

const PHONE_SECTIONS = 3

function Line({ line, lead }: { line: BriefLine; lead?: boolean }) {
  const text = (
    <span data-tone={line.tone} className={cx(line.tone && line.tone !== 'neutral' ? 'tone-text' : lead ? 'text-fg' : 'text-fg-2')}>
      {line.text}
    </span>
  )
  const cls = cx('flex min-w-0 items-start gap-1', lead ? 'text-ui font-semibold' : 'text-body')
  if (!line.href) return <p className={cls}>{text}</p>
  return (
    <Link to={line.href} className={cx(cls, 'group -mx-1 rounded-control px-1 hover:bg-surface-hover [@media(pointer:coarse)]:min-h-[32px] [@media(pointer:coarse)]:items-center')}>
      {text}
      <ChevronRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint group-hover:text-accent-600" />
    </Link>
  )
}

function BriefSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2"><Skeleton className="h-6 w-44" /><Skeleton className="h-3 w-32" /></div>
      <Skeleton className="h-5 w-3/4" />
      {[0, 1, 2].map(i => (
        <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-3">
          <Skeleton className="h-3 w-16" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-2/3" /></div>
        </div>
      ))}
    </div>
  )
}

/**
 * The rule-based morning brief (no AI): greeting and date, the one headline
 * that matters most right now, then compact labelled sections. Phones show
 * the headline plus the first few sections behind a "Show all".
 */
export function DailyBrief() {
  const { brief, isLoading } = useDailyBrief()
  const isPhone = useBreakpoint() === 'phone'
  const [expanded, setExpanded] = useState(false)
  const sections = isPhone && !expanded ? brief.sections.slice(0, PHONE_SECTIONS) : brief.sections
  const hidden = brief.sections.length - sections.length

  return (
    <Card>
      {isLoading ? <BriefSkeleton /> : (
        <>
          <header className="mb-3">
            <h1 id="daily-brief-title" className="text-title font-bold tracking-tight text-fg sm:text-head">{brief.greeting}</h1>
            <p className="text-meta tabular-nums text-fg-muted">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
          </header>

          <div className="mb-4 flex items-start gap-2 rounded-row bg-surface-2 px-3 py-2.5">
            <ToneDot tone={brief.headline.tone ?? 'accent'} className="mt-1.5 shrink-0" />
            <div className="min-w-0 flex-1"><Line line={brief.headline} lead /></div>
          </div>

          {sections.length > 0 && (
            <dl className="max-w-prose space-y-3">
              {sections.map(section => (
                <div key={section.id} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
                  <dt><SectionLabel className="sm:pt-0.5">{section.title}</SectionLabel></dt>
                  <dd className="min-w-0 space-y-0.5">
                    {section.lines.map((line, i) => <Line key={i} line={line} />)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {isPhone && (hidden > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="mt-2 inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600"
            >
              {expanded ? 'Show less' : `Show all (${hidden} more)`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
