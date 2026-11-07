import { Suspense, useEffect, useRef } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PageContainer, PageHeader, SegmentedControl, SkeletonTab, SteadySlot } from '../../../shared/ui'
import { TrainingHeroArt } from '../components/TrainingHeroArt'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { HevySyncButton } from '../components/HevySyncButton'
import { NextTab } from '../components/next/NextTab'
import { TrainingProgressProvider } from '../components/next/TrainingProgressProvider'
import {
  LIBRARY_VIEWS, LOG_VIEWS, TRAINING_TABS, movedLogView, parseLibraryView, parseLogView, parseTrainingTab, viewSlotOf,
  type LibraryView, type LogView, type TrainingTabId,
} from './trainingTabs'

// Next is in the page's own code; the other tabs load when opened, and in
// idle time once the page shows (their charts and the body map were most of
// the page's first download).
const ProgramTab = lazyPart('training-program', () => import('../components/program/ProgramTab').then(m => m.ProgramTab))
const ProgressTab = lazyPart('training-progress', () => import('../components/ProgressTab').then(m => m.ProgressTab))
const LogTab = lazyPart('training-log', () => import('../components/log/LogTab').then(m => m.LogTab))
const LibraryTab = lazyPart('training-library', () => import('../components/HevyTab').then(m => m.LibraryTab))
const PTCoachTab = lazyPart('training-coach', () => import('../components/PTCoachTab').then(m => m.PTCoachTab))
const OTHER_TABS = [ProgramTab, ProgressTab, LogTab, LibraryTab, PTCoachTab]

// Training: Next (what to do today, set by set) · Program (the plan and what
// it adds up to) · Progress (what changed) · Log (what you did: Hevy with the
// calendar, or Strava) · Library (routines, exercises) · Coach. The tab lives
// in `?tab=` and a tab's own view (Log: Hevy | Strava, Library: Routines |
// Exercises) in `?view=`, switched right after the tabs in the same row, so
// links and Back work. Each tab lays its cards out with a PageBoard
// (trainingBoards.ts): a wide screen adds columns instead of length.
export function TrainingPage() {
  const [params, setParams] = useSearchParams()
  const tab = parseTrainingTab(params.get('tab'))
  useIdlePreload(OTHER_TABS)
  const rawView = params.get('view')
  const goTo = (next: TrainingTabId) => {
    setParams(p => { const n = new URLSearchParams(p); n.set('tab', next); n.delete('view'); return n }, { replace: true })
  }
  const setView = (view: string) => {
    setParams(p => { const n = new URLSearchParams(p); n.set('view', view); return n }, { replace: true })
  }

  // The active pill is scrolled into view on a narrow phone strip.
  const activePillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  // Body measurements moved to Health → Body; an old link still lands there.
  const moved = movedLogView(tab, rawView)
  if (moved) return <Navigate to={moved} replace />

  const logView = parseLogView(rawView)
  const libraryView = parseLibraryView(rawView)
  const viewsShown = viewSlotOf(tab)

  // One bar for every tab (owner, 03.11.2026: "should not be reshaped, moved, resized when changing
  // tabs"): as wide as the page on every tab (Library and Strava take the whole page, so there is no
  // narrower board to stop at), with the same lines and the same places — a tab's own views sit in a
  // slot kept on every tab, small enough (xs) not to outgrow the Sync buttons' row.
  return (
    <PageContainer>
      <PageHeader title="Training" art={<TrainingHeroArt />}>
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <div role="tablist" aria-label="Training sections" className="scroll-x -mx-3 flex min-w-0 basis-[calc(100%+1.5rem)] gap-1 px-3 lg:mx-0 lg:basis-auto lg:px-0">
            {TRAINING_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                ref={tab === t.id ? activePillRef : undefined}
                onClick={() => goTo(t.id)}
                className="pill-tab shrink-0"
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* A tab's own views follow the tabs (with Sync, their own row below the tabs on a narrow screen). */}
          <SteadySlot className="shrink-0" show={viewsShown} items={{
            log: <SegmentedControl<LogView> size="xs" value={logView} onChange={setView} options={LOG_VIEWS} />,
            library: <SegmentedControl<LibraryView> size="xs" value={libraryView} onChange={setView} options={LIBRARY_VIEWS} />,
          }} />
          <div className="ml-auto shrink-0"><HevySyncButton /></div>
        </div>
      </PageHeader>

      <div className="w-full min-w-0">
        <ErrorBoundary key={tab} label="Training">
          <Suspense fallback={<SkeletonTab />}>
            {(tab === 'next' || tab === 'progress') && (
              <TrainingProgressProvider>
                {tab === 'next' ? <NextTab onGoTo={goTo} /> : <ProgressTab />}
              </TrainingProgressProvider>
            )}
            {tab === 'program' && <ProgramTab />}
            {tab === 'log' && <LogTab view={logView} />}
            {tab === 'library' && <LibraryTab view={libraryView} />}
            {tab === 'coach' && <PTCoachTab />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </PageContainer>
  )
}
