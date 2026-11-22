import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../../../shared/ui'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { AI_VIEWS, AI_VIEW_LABEL, parseAiView, type AiView } from '../../developerBoards'
import { AiCalls } from './AiCalls'
import { AiHowItWorks } from './AiHowItWorks'
import { AiOverview } from './AiOverview'
import { AiPrices } from './AiPrices'
import { AiSettingsView } from './AiSettingsView'
import { AiTestBench } from './AiTestBench'

// Developer → AI: the Claude layer in six views — what it cost (Overview), every call (Calls), what the owner
// controls (Settings), what the costs are worked out from (Prices) and how it is built (How it works) and a place to try it (Test bench). The view
// lives in `?view=`, switched under the page's bar (which keeps its shape on every tab: THEME.md §6.3). Each
// view sits in its own ErrorBoundary: what the function and the ledger answer is read field by field
// (ledgerRules), and a shape nobody expected still stays inside its view.

const OPTIONS = AI_VIEWS.map(v => ({ value: v, label: AI_VIEW_LABEL[v] }))

export function AiTab() {
  const [params, setParams] = useSearchParams()
  const view = parseAiView(params.get('view'))
  // Six views do not fit a phone's width: the chosen one (the last, when it comes from a link) scrolls into sight.
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bar.current?.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [view])
  const setView = (next: AiView) => {
    setParams(p => {
      const n = new URLSearchParams(p)
      if (next === 'overview') n.delete('view'); else n.set('view', next)
      return n
    }, { replace: true })
  }

  return (
    <>
      <div ref={bar} className="scroll-x mb-3 sm:mb-4">
        <SegmentedControl<AiView> fit size="sm" label="AI views" options={OPTIONS} value={view} onChange={setView} />
      </div>
      <ErrorBoundary key={view} label={`AI · ${AI_VIEW_LABEL[view]}`} action="developer_ai_render">
        {view === 'overview' && <AiOverview onOpen={setView} />}
        {view === 'calls' && <AiCalls />}
        {view === 'settings' && <AiSettingsView />}
        {view === 'prices' && <AiPrices />}
        {view === 'how' && <AiHowItWorks />}
        {view === 'bench' && <AiTestBench />}
      </ErrorBoundary>
    </>
  )
}
