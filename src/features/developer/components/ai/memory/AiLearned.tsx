import { lazy, Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBoard, SegmentedControl } from '../../../../../shared/ui'
import { SkeletonTab } from '../../../../../shared/components/Skeleton'
import { ErrorBoundary } from '../../../../../shared/components/ErrorBoundary'
import { AI_LEARNED_BOARD, type AiLearnedSection } from '../../../developerBoards'
import { useLearnWaiting } from '../../../../ai/claude/hooks/useLearn'
import { LEARN_VIEW_LABEL, LEARN_VIEW_MEANING, LEARN_VIEWS, type LearnView } from '../../../../ai/claude/learnRules'
import { SetAside } from './SetAside'
import { Waiting } from './memoryBits'

// Developer → AI → Learned: everything the AI learned and how it is tuned, in six views (`?mem=`): Fixes (the owner's
// corrections), Rules, Cases, Notes, Tuning (the weekly self-test) and Sites (source memory). Each view loads when it is
// opened and sits in its own ErrorBoundary: every row is read field by field (learnRules), so a shape nobody expected stays
// inside its view. The owner changes one thing of a row, its state, always with an Undo. On a wide screen what the view is
// and "Set aside what was learned" sit beside it (PageBoard, AI_LEARNED_BOARD).

const VIEWS: Record<LearnView, React.LazyExoticComponent<() => React.JSX.Element>> = {
  corrections: lazy(() => import('./MemoryCorrections').then(m => ({ default: m.MemoryCorrections }))),
  rules: lazy(() => import('./MemoryRules').then(m => ({ default: m.MemoryRules }))),
  cases: lazy(() => import('./MemoryCases').then(m => ({ default: m.MemoryCases }))),
  lessons: lazy(() => import('./MemoryLessons').then(m => ({ default: m.MemoryLessons }))),
  tuning: lazy(() => import('./MemoryTuning').then(m => ({ default: m.MemoryTuning }))),
  sources: lazy(() => import('./MemorySources').then(m => ({ default: m.MemorySources }))),
}

export function AiLearned() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('mem')
  const view: LearnView = (LEARN_VIEWS as readonly string[]).includes(raw ?? '') ? raw as LearnView : 'corrections'
  const waiting = useLearnWaiting()
  const count: Partial<Record<LearnView, number>> = { rules: waiting.rules, lessons: waiting.lessons, tuning: waiting.tuning }
  const go = (next: LearnView) => setParams(p => {
    const n = new URLSearchParams(p)
    if (next === 'corrections') n.delete('mem'); else n.set('mem', next)
    return n
  }, { replace: true })
  const View = VIEWS[view]
  const sections: Record<AiLearnedSection, ReactNode> = {
    view: (
      <ErrorBoundary key={view} label={`AI · Learned · ${LEARN_VIEW_LABEL[view]}`} action="developer_ai_learned_render">
        <Suspense fallback={<SkeletonTab />}>
          <div className="flex flex-col gap-3"><View /></div>
        </Suspense>
      </ErrorBoundary>
    ),
    side: (
      <div className="flex flex-col gap-3">
        <p className="text-meta text-fg-muted">{LEARN_VIEW_MEANING[view]}</p>
        <SetAside />
      </div>
    ),
  }
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl<LearnView> fit size="xs" label="Learned" options={LEARN_VIEWS.map(v => ({ value: v, label: count[v] !== undefined ? <>{LEARN_VIEW_LABEL[v]}<Waiting n={count[v] ?? 0} /></> : LEARN_VIEW_LABEL[v] }))} value={view} onChange={go} />
      <PageBoard sections={sections} layout={AI_LEARNED_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
    </div>
  )
}
