import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { HevySyncButton } from '../components/HevySyncButton'
import { NextTab } from '../components/next/NextTab'
import { TrainingProgressProvider } from '../components/next/TrainingProgressProvider'
import { ProgramTab } from '../components/program/ProgramTab'
import { ProgressTab } from '../components/ProgressTab'
import { LogTab } from '../components/log/LogTab'
import { LibraryTab } from '../components/HevyTab'
import { PTCoachTab } from '../components/PTCoachTab'
import { TRAINING_TABS, parseTrainingTab, type TrainingTabId } from './trainingTabs'

// Training: Next (what to do today, set by set) · Program (the plan and what
// it adds up to) · Progress (what changed) · Log (what you did: workouts,
// Strava, body) · Library (exercises, routines, records) · Coach. The tab
// lives in `?tab=` so links and Back work. Every tab is content-sized and
// left-aligned; the old right-hand calendar rail now sits inside Log.
export function TrainingPage() {
  const [params, setParams] = useSearchParams()
  const tab = parseTrainingTab(params.get('tab'))
  const goTo = (next: TrainingTabId) => {
    setParams(p => { const n = new URLSearchParams(p); n.set('tab', next); return n }, { replace: true })
  }

  // The active pill is scrolled into view on a narrow phone strip.
  const activePillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  return (
    <PageContainer width="full">
      <PageHeader title="Training" className="2xl:max-w-[117rem]">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <div role="tablist" aria-label="Training sections" className="scroll-x -mx-4 flex min-w-0 basis-[calc(100%+2rem)] gap-1 px-4 sm:mx-0 sm:basis-auto sm:flex-1 sm:px-0">
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
          <span className="ml-auto shrink-0 sm:ml-0"><HevySyncButton /></span>
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
          {tab === 'log' && <LogTab />}
          {tab === 'library' && <LibraryTab />}
          {tab === 'coach' && <PTCoachTab />}
        </ErrorBoundary>
      </div>
    </PageContainer>
  )
}
