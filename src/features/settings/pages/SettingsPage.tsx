import { useSearchParams } from 'react-router-dom'
import { HERO_BAND_BLEED, PageContainer, PageHeader, cx, usePageStep } from '../../../shared/ui'
import { boardWidthRem } from '../../../shared/ui/pageBoardRules'
import { ConnectionsTab } from '../../developer/components/ConnectionsTab'
import { CONNECTIONS_BOARD } from '../../developer/developerBoards'
import { PlacesTab } from '../components/PlacesTab'
import { AppearanceTab } from '../components/AppearanceTab'
import { FoodTab } from '../components/FoodTab'
import { ApisTab } from '../components/ApisTab'
import { SettingsHeroArt } from '../components/SettingsHeroArt'
import { APIS_BOARD, APPEARANCE_BOARD, FOOD_SETTINGS_BOARD, PLACES_BOARD } from '../settingsBoards'

type Tab = 'places' | 'appearance' | 'food' | 'subscriptions' | 'apis'

const TABS: { id: Tab; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'food', label: 'Food' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'apis', label: 'Integrations and APIs' },
]
const BOARD = { places: PLACES_BOARD, appearance: APPEARANCE_BOARD, food: FOOD_SETTINGS_BOARD, subscriptions: CONNECTIONS_BOARD, apis: APIS_BOARD } as const

/** /settings — Places · Appearance · Food · Subscriptions · Integrations and APIs, the tab kept in ?tab=.
 *  The old `?tab=integrations` (the Subscriptions tab's earlier id) still opens Subscriptions. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') === 'integrations' ? 'subscriptions' : params.get('tab')
  const tab: Tab = TABS.some(t => t.id === raw) ? raw as Tab : 'places'
  // The header stops where the tab's board does.
  const { ref: widthRef, step } = usePageStep<HTMLDivElement>()
  const headerCap = step == null ? null : boardWidthRem(BOARD[tab], step)

  function selectTab(next: Tab) {
    // Keep other params (a Strava OAuth return lands on ?tab=subscriptions&code=…).
    setParams(p => { p.set('tab', next); return p }, { replace: true })
  }

  return (
    <PageContainer>
      <div ref={widthRef}>
        <div style={headerCap != null ? { maxWidth: `${headerCap}rem` } : undefined}>
          <PageHeader title="Settings" art={<SettingsHeroArt />}>
            <div role="tablist" aria-label="Settings sections" className={cx('scroll-x flex gap-1', HERO_BAND_BLEED)}>
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
      {tab === 'food' && <FoodTab />}
      {tab === 'subscriptions' && <ConnectionsTab />}
      {tab === 'apis' && <ApisTab />}
    </PageContainer>
  )
}
