import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../../../shared/ui'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { AI_LEARN_LABEL, AI_LEARN_VIEWS, AI_VIEWS, AI_VIEW_LABEL, parseAiLocation, type AiLearnView, type AiView } from '../../developerBoards'
import { AiBatches } from './AiBatches'
import { AiCalls } from './AiCalls'
import { AiHowItWorks } from './AiHowItWorks'
import { AiOverview } from './AiOverview'
import { AiPrices } from './AiPrices'
import { AiSuggestions } from './AiSuggestions'
import { AiSettingsView } from './AiSettingsView'
import { AiTestBench } from './AiTestBench'

// Developer → AI: the Claude layer in four views — what it cost (Overview), every call (Calls), what the owner
// controls (Settings) and everything that explains it (Learn: How it works, Prices, Test bench, Batches, Ideas). The view lives in
// `?view=` and Learn's page in `?learn=`; they are switched under the page's bar (which keeps its shape on every
// tab: THEME.md §6.3), and Learn's own switcher sits under it, only inside Learn. Each view sits in its own
// ErrorBoundary: what the function and the ledger answer is read field by field (ledgerRules), and a shape nobody
// expected still stays inside its view.

const OPTIONS = AI_VIEWS.map(v => ({ value: v, label: AI_VIEW_LABEL[v] }))
const LEARN_OPTIONS = AI_LEARN_VIEWS.map(v => ({ value: v, label: AI_LEARN_LABEL[v] }))

export function AiTab() {
  const [params, setParams] = useSearchParams()
  const { view, learn } = parseAiLocation(params.get('view'), params.get('learn'))
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
        <SegmentedControl<AiView> fit size="sm" label="AI views" options={OPTIONS} value={view} onChange={v => go(v, learn)} />
      </div>
      {view === 'learn' && (
        <div className="mb-3 sm:mb-4">
          <SegmentedControl<AiLearnView> fit size="xs" label="Learn" options={LEARN_OPTIONS} value={learn} onChange={l => go('learn', l)} />
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
      </ErrorBoundary>
    </>
  )
}
