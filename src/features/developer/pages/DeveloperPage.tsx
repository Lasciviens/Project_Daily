import { Suspense, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { ErrorLogTab } from '../components/ErrorLogTab'
import { ActivityLogTab } from '../components/ActivityLogTab'
import { MemoryTab } from '../components/MemoryTab'
import { DeveloperHeroArt } from '../components/DeveloperHeroArt'
import { HERO_BAND_BLEED, PageContainer, PageHeader, SkeletonTab, cx } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'

// The AI tab (the Claude layer's four views, Learn's three pages, with its chart) loads when opened, and in idle time once the page shows.
const AiTab = lazyPart('developer-ai', () => import('../components/ai/AiTab').then(m => m.AiTab))
const OTHER_TABS = [AiTab]

type Tab = 'activity' | 'errors' | 'memory' | 'ai'

const TABS: { id: Tab; label: string }[] = [
  { id: 'activity',    label: 'Activity' },
  { id: 'errors',      label: 'Errors' },
  { id: 'memory',      label: 'Memory' },
  { id: 'ai',          label: 'AI' },
]

export function DeveloperPage() {
  // ?tab= deep-links straight to one tab instead of always landing on Activity.
  const [params, setParams] = useSearchParams()
  const initial = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') as Tab : 'activity'
  const [tab, setTab] = useState<Tab>(initial)
  useIdlePreload(OTHER_TABS)

  function selectTab(next: Tab) {
    setTab(next)
    // A tab's own view (?view= and ?learn=, the AI tab's) doesn't follow to another tab.
    setParams(p => { p.set('tab', next); p.delete('view'); p.delete('learn'); return p }, { replace: true })
  }

  // Connections moved to Settings → Subscriptions. An old link (or a Strava
  // redirect still in flight) keeps every other query param on the way.
  if (params.get('tab') === 'connections') {
    const next = new URLSearchParams(params)
    next.set('tab', 'subscriptions')
    return <Navigate to={`/settings?${next.toString()}`} replace />
  }

  return (
    <PageContainer>
      {/* The header band is the page's width, like every page's (THEME §6.3): it never resizes on a switch. */}
      <PageHeader
            title="Developer"
            art={<DeveloperHeroArt />}
          >
            <div role="tablist" aria-label="Developer sections" className={cx('scroll-x flex gap-1', HERO_BAND_BLEED)}>
              {TABS.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => selectTab(t.id)} className="pill-tab">
                  {t.label}
                </button>
              ))}
            </div>
      </PageHeader>

      {tab === 'activity'    && <ActivityLogTab />}
      {tab === 'errors'      && <ErrorLogTab />}
      {tab === 'memory'      && <MemoryTab />}
      {tab === 'ai'          && (
        <ErrorBoundary label="AI" action="developer_ai_render">
          <Suspense fallback={<SkeletonTab />}>
            <AiTab />
          </Suspense>
        </ErrorBoundary>
      )}
    </PageContainer>
  )
}
