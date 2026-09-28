import { useEffect, useRef } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PageContainer, PageHeader, SegmentedControl, cx } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { HevySyncButton } from '../components/HevySyncButton'
import { NextTab } from '../components/next/NextTab'
import { TrainingProgressProvider } from '../components/next/TrainingProgressProvider'
import { ProgramTab } from '../components/program/ProgramTab'
import { ProgressTab } from '../components/ProgressTab'
import { LogTab } from '../components/log/LogTab'
import { LibraryTab } from '../components/HevyTab'
import { PTCoachTab } from '../components/PTCoachTab'
import {
  LIBRARY_VIEWS, LOG_VIEWS, TRAINING_TABS, movedLogView, parseLibraryView, parseLogView, parseTrainingTab,
  type LibraryView, type LogView, type TrainingTabId,
} from './trainingTabs'

// Training: Next (what to do today, set by set) · Program (the plan and what
// it adds up to) · Progress (what changed) · Log (what you did: Hevy with the
// calendar, or Strava) · Library (routines, exercises) · Coach. The tab lives
// in `?tab=` and a tab's own view (Log: Hevy | Strava, Library: Routines |
// Exercises) in `?view=`, switched at the right end of the same tab row, so
// links and Back work. Every tab is content-sized and left-aligned.
export function TrainingPage() {
  const [params, setParams] = useSearchParams()
  const tab = parseTrainingTab(params.get('tab'))
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
  const subViews = tab === 'log'
    ? <SegmentedControl<LogView> size="sm" value={logView} onChange={setView} options={LOG_VIEWS} />
    : tab === 'library'
      ? <SegmentedControl<LibraryView> size="sm" value={libraryView} onChange={setView} options={LIBRARY_VIEWS} />
      : null

  return (
    <PageContainer width="full">
      <PageHeader title="Training" className="2xl:max-w-[117rem]">
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <div role="tablist" aria-label="Training sections" className="scroll-x -mx-4 flex min-w-0 basis-[calc(100%+2rem)] gap-1 px-4 sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 lg:mx-0 lg:basis-auto lg:flex-1 lg:px-0">
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
          {/* A tab's own views sit at the right end of the row (their own
              row, with Sync, below the tabs on a narrow screen). */}
          <div className={cx('flex min-w-0 flex-1 items-center gap-2 lg:flex-none', subViews ? 'justify-between lg:justify-end' : 'justify-end')}>
            {subViews}
            <HevySyncButton />
          </div>
        </div>
      </PageHeader>

      <div className="w-full min-w-0 2xl:max-w-[117rem]">
        <ErrorBoundary key={tab} label="Training">
          {(tab === 'next' || tab === 'progress') && (
            <TrainingProgressProvider>
              {tab === 'next' ? <NextTab onGoTo={goTo} /> : <ProgressTab />}
            </TrainingProgressProvider>
          )}
          {tab === 'program' && <ProgramTab />}
          {tab === 'log' && <LogTab view={logView} />}
          {tab === 'library' && <LibraryTab view={libraryView} />}
          {tab === 'coach' && <PTCoachTab />}
        </ErrorBoundary>
      </div>
    </PageContainer>
  )
}
