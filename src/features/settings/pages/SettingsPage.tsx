import { useSearchParams } from 'react-router-dom'
import { HERO_BAND_BLEED, PageContainer, PageHeader, cx } from '../../../shared/ui'
import { ConnectionsTab } from '../../developer/components/ConnectionsTab'
import { PlacesTab } from '../components/PlacesTab'
import { AppearanceTab } from '../components/AppearanceTab'
import { FoodTab } from '../components/FoodTab'
import { ProfileTab } from '../components/ProfileTab'
import { ApisTab } from '../components/ApisTab'
import { CalendarTab } from '../components/CalendarTab'
import { SettingsHeroArt } from '../components/SettingsHeroArt'

type Tab = 'places' | 'profile' | 'appearance' | 'food' | 'calendar' | 'subscriptions' | 'apis'

const TABS: { id: Tab; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'food', label: 'Food' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'apis', label: 'Integrations and APIs' },
]

/** /settings — Places · Profile · Appearance · Food · Calendar · Subscriptions · Integrations and APIs, the tab kept in ?tab=.
 *  The old `?tab=integrations` (the Subscriptions tab's earlier id) still opens Subscriptions. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') === 'integrations' ? 'subscriptions' : params.get('tab')
  const tab: Tab = TABS.some(t => t.id === raw) ? raw as Tab : 'places'

  function selectTab(next: Tab) {
    // Keep other params (a Strava OAuth return lands on ?tab=subscriptions&code=…).
    setParams(p => { p.set('tab', next); return p }, { replace: true })
  }

  return (
    <PageContainer>
      {/* The header band is the page's width, like every page's (THEME §6.3): it never resizes between tabs. */}
      <PageHeader title="Settings" art={<SettingsHeroArt />}>
            <div role="tablist" aria-label="Settings sections" className={cx('scroll-x flex gap-1', HERO_BAND_BLEED)}>
              {TABS.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => selectTab(t.id)} className="pill-tab">
                  {t.label}
                </button>
              ))}
            </div>
      </PageHeader>

      {tab === 'places' && <PlacesTab />}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'food' && <FoodTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'subscriptions' && <ConnectionsTab />}
      {tab === 'apis' && <ApisTab />}
    </PageContainer>
  )
}
