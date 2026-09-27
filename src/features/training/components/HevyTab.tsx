import { useState, useEffect, useRef } from 'react'
import { Button } from '../../../shared/ui'
import { Plus } from 'lucide-react'
import { PRsSubTab } from './HevyPRList'
import { HevyWorkoutsList } from './HevyWorkoutsList'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import { LogHevyWorkoutModal } from './LogHevyWorkoutModal'
import { WorkedMuscles } from './WorkedMuscles'
import { ProgressTab } from './ProgressTab'

type SubTab = 'workouts' | 'routines' | 'prs' | 'progress' | 'muscles' | 'body' | 'exercises'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'         },
  { id: 'routines',  label: 'Routines'          },
  { id: 'prs',       label: 'Personal records'  },
  { id: 'progress',  label: 'Progress'          },
  { id: 'muscles',   label: 'Muscles'           },
  { id: 'body',      label: 'Body'              },
  { id: 'exercises', label: 'Exercises'         },
]

// ─── HevyTab ──────────────────────────────────────────────────────────────────

export function HevyTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('workouts')
  const [logOpen, setLogOpen] = useState(false)
  const activeSubRef = useRef<HTMLButtonElement>(null)

  // Keep the active sub-tab in view on the scrolling phone strip.
  useEffect(() => {
    activeSubRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeTab])

  return (
    <div className="flex flex-col gap-3">
      {/* Seven sub-tabs never fit a phone, so the strip scrolls to the screen
          edge. The Log action sits with the Workouts content below instead of
          beside the strip, where it cut the last tab off mid-word. */}
      <div>
        <div role="tablist" aria-label="Hevy sections" className="scroll-x -mx-4 flex min-w-0 border-b border-line px-4 sm:mx-0 sm:px-0">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              ref={activeTab === tab.id ? activeSubRef : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3 text-body transition-colors ${
                activeTab === tab.id
                  ? 'border-accent-500 font-semibold text-fg'
                  : 'border-transparent font-medium text-fg-muted hover:text-fg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === 'workouts' && (
        <div className="flex">
          <Button variant="primary" icon={<Plus />} onClick={() => setLogOpen(true)} className="shrink-0">
            Log workout
          </Button>
        </div>
      )}

      {/* Sub-tab content — width is managed by the page (calendar lives there) */}
      <div>
        {activeTab === 'workouts'  && <HevyWorkoutsList />}
        {activeTab === 'routines'  && <RoutinesTab />}
        {activeTab === 'prs'       && <PRsSubTab />}
        {activeTab === 'progress'  && <ProgressTab />}
        {activeTab === 'muscles'   && <WorkedMuscles />}
        {activeTab === 'body'      && <BodyMeasurementsTab />}
        {activeTab === 'exercises' && <ExerciseTemplatesTab />}
      </div>

      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}
