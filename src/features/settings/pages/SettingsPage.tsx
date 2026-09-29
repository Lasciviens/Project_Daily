import { useSearchParams } from 'react-router-dom'
import { PageContainer, PageHeader, usePageStep } from '../../../shared/ui'
import { boardWidthRem } from '../../../shared/ui/pageBoardRules'
import { ConnectionsTab } from '../../developer/components/ConnectionsTab'
import { CONNECTIONS_BOARD } from '../../developer/developerBoards'
import { PlacesTab } from '../components/PlacesTab'
import { AppearanceTab } from '../components/AppearanceTab'
import { APPEARANCE_BOARD, PLACES_BOARD } from '../settingsBoards'

type Tab = 'places' | 'appearance' | 'integrations'

const TABS: { id: Tab; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'integrations', label: 'Integrations' },
]
const BOARD = { places: PLACES_BOARD, appearance: APPEARANCE_BOARD, integrations: CONNECTIONS_BOARD } as const

/** /settings — Places · Appearance · Integrations, the tab kept in ?tab=. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = TABS.some(t => t.id === raw) ? raw as Tab : 'places'
  // The header stops where the tab's board does.
  const { ref: widthRef, step } = usePageStep<HTMLDivElement>()
  const headerCap = step == null ? null : boardWidthRem(BOARD[tab], step)

  function selectTab(next: Tab) {
    // Keep other params (a Strava OAuth return lands on ?tab=integrations&code=…).
    setParams(p => { p.set('tab', next); return p }, { replace: true })
  }

  return (
    <PageContainer>
      <div ref={widthRef}>
        <div style={headerCap != null ? { maxWidth: `${headerCap}rem` } : undefined}>
          <PageHeader title="Settings">
            <div role="tablist" aria-label="Settings sections" className="scroll-x -mx-4 flex gap-1 px-4 sm:mx-0 sm:px-0">
              {TABS.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => selectTab(t.id)} className="pill-tab">
                  {t.label}
                </button>
              ))}
            </div>
          </PageHeader>
        </div>
      </div>

      {tab === 'places' && <PlacesTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'integrations' && <ConnectionsTab />}
    </PageContainer>
  )
}
