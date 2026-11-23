import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../../../../shared/ui'
import { SkeletonTab } from '../../../../../shared/components/Skeleton'
import { ErrorBoundary } from '../../../../../shared/components/ErrorBoundary'
import { LEARN_VIEW_LABEL, LEARN_VIEW_MEANING, LEARN_VIEWS, type LearnView } from '../../../../ai/claude/learnRules'

// Developer → AI → Learn → Memory: everything the AI learned and how it is tuned, in six views (`?mem=`): Fixes (the owner's
// corrections), Rules, Cases, Notes (lessons), Tuning (the weekly self-test) and Sites (source memory). Each view loads when it
// is opened and sits in its own ErrorBoundary: every row is read field by field (learnRules), and a shape nobody expected stays
// inside its view. The owner may change one thing of a row, its state, always with an Undo.

const VIEWS: Record<LearnView, React.LazyExoticComponent<() => React.JSX.Element>> = {
  corrections: lazy(() => import('./MemoryCorrections').then(m => ({ default: m.MemoryCorrections }))),
  rules: lazy(() => import('./MemoryRules').then(m => ({ default: m.MemoryRules }))),
  cases: lazy(() => import('./MemoryCases').then(m => ({ default: m.MemoryCases }))),
  lessons: lazy(() => import('./MemoryLessons').then(m => ({ default: m.MemoryLessons }))),
  tuning: lazy(() => import('./MemoryTuning').then(m => ({ default: m.MemoryTuning }))),
  sources: lazy(() => import('./MemorySources').then(m => ({ default: m.MemorySources }))),
}

export function AiMemory() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('mem')
  const view: LearnView = (LEARN_VIEWS as readonly string[]).includes(raw ?? '') ? raw as LearnView : 'corrections'
  const go = (next: LearnView) => setParams(p => {
    const n = new URLSearchParams(p)
    if (next === 'corrections') n.delete('mem'); else n.set('mem', next)
    return n
  }, { replace: true })
  const View = VIEWS[view]
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <SegmentedControl<LearnView> fit size="xs" label="Memory" options={LEARN_VIEWS.map(v => ({ value: v, label: LEARN_VIEW_LABEL[v] }))} value={view} onChange={go} />
      <p className="text-meta text-fg-muted">{LEARN_VIEW_MEANING[view]}</p>
      <ErrorBoundary key={view} label={`AI · Memory · ${LEARN_VIEW_LABEL[view]}`} action="developer_ai_memory_render">
        <Suspense fallback={<SkeletonTab />}>
          <View />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
