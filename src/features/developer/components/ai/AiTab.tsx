import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../../../shared/ui'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { SkeletonTab } from '../../../../shared/components/Skeleton'
import { AI_LEARN_LABEL, AI_LEARN_VIEWS, AI_VIEWS, AI_VIEW_LABEL, parseAiLocation, type AiLearnView, type AiView } from '../../developerBoards'
import { useSuggestions } from '../../../ai/claude/hooks/useSuggestions'
import { waitingCount } from '../../../ai/claude/suggestRules'
import { AiBatches } from './AiBatches'
import { AiCalls } from './AiCalls'
import { AiHowItWorks } from './AiHowItWorks'
import { AiOverview } from './AiOverview'
import { AiPrices } from './AiPrices'
import { AiSuggestions } from './AiSuggestions'
import { AiSettingsView } from './AiSettingsView'
import { AiTestBench } from './AiTestBench'

// Memory (what the AI learned, migration 204) loads only when it is opened.
const AiMemory = lazy(() => import('./memory/AiMemory').then(m => ({ default: m.AiMemory })))

// Developer → AI: the Claude layer in four views — what it cost (Overview), every call (Calls), what the owner
// controls (Settings) and everything that explains it (Learn: How it works, Prices, Bench, Batches, Suggestions, Memory). The view lives in
// `?view=` and Learn's page in `?learn=`; they are switched under the page's bar (which keeps its shape on every
// tab: THEME.md §6.3), and Learn's own switcher sits under it, only inside Learn. Each view sits in its own
// ErrorBoundary: what the function and the ledger answer is read field by field (ledgerRules), and a shape nobody
// expected still stays inside its view.

/** The number of suggestions waiting for a decision, as a small count beside the name. */
function Waiting({ n }: { n: number }) {
  // Always the same room (invisible with nothing waiting), so the count landing never moves the tabs beside it.
  return <span aria-hidden={n <= 0} aria-label={n > 0 ? `${n} waiting` : undefined} className={`ml-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-micro font-semibold leading-none text-on-accent${n > 0 ? '' : ' invisible'}`}>{n > 9 ? '9+' : Math.max(n, 0)}</span>
}

export function AiTab() {
  const [params, setParams] = useSearchParams()
  const { view, learn } = parseAiLocation(params.get('view'), params.get('learn'))
  // Suggestions waiting for a decision: a count beside Learn and beside Suggestions. A failed read shows no count (the badge only adds).
  const waiting = waitingCount(useSuggestions().data ?? [])
  const options = AI_VIEWS.map(v => ({ value: v, label: v === 'learn' ? <>{AI_VIEW_LABEL[v]}<Waiting n={waiting} /></> : AI_VIEW_LABEL[v] }))
  const learnOptions = AI_LEARN_VIEWS.map(v => ({ value: v, label: v === 'suggestions' ? <>{AI_LEARN_LABEL[v]}<Waiting n={waiting} /></> : AI_LEARN_LABEL[v] }))
  const go = (next: AiView, nextLearn: AiLearnView) => {
    setParams(p => {
      const n = new URLSearchParams(p)
      if (next === 'overview') n.delete('view'); else n.set('view', next)
      if (next === 'learn' && nextLearn !== 'how') n.set('learn', nextLearn); else n.delete('learn')
      return n
    }, { replace: true })
  }

  return (
    <>
      <div className="mb-3 sm:mb-4">
        <SegmentedControl<AiView> fit size="sm" label="AI views" options={options} value={view} onChange={v => go(v, learn)} />
      </div>
      {view === 'learn' && (
        <div className="mb-3 sm:mb-4">
          <SegmentedControl<AiLearnView> fit size="xs" label="Learn" options={learnOptions} value={learn} onChange={l => go('learn', l)} />
        </div>
      )}
      <ErrorBoundary key={view === 'learn' ? learn : view} label={`AI · ${view === 'learn' ? AI_LEARN_LABEL[learn] : AI_VIEW_LABEL[view]}`} action="developer_ai_render">
        {view === 'overview' && <AiOverview onOpen={v => go(v, learn)} />}
        {view === 'calls' && <AiCalls />}
        {view === 'settings' && <AiSettingsView />}
        {view === 'learn' && learn === 'how' && <AiHowItWorks />}
        {view === 'learn' && learn === 'prices' && <AiPrices />}
        {view === 'learn' && learn === 'bench' && <AiTestBench />}
        {view === 'learn' && learn === 'batches' && <AiBatches />}
        {view === 'learn' && learn === 'suggestions' && <AiSuggestions />}
        {view === 'learn' && learn === 'memory' && <Suspense fallback={<SkeletonTab />}><AiMemory /></Suspense>}
      </ErrorBoundary>
    </>
  )
}
