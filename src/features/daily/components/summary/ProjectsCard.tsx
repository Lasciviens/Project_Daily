import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveProjectItems, useSetProjectItemStatus, type ActiveProjectItem } from '../../hooks/useDailyHub'
import { UnifiedPlanModal } from '../../../../shared/components/plan-modal'

const PRIO_DOT: Record<string, string> = { high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-ink-300' }

// 📁 Most actionable project items (in-progress first), plannable into the
// viewed day (source_type project_item — the linked-entity triggers keep the
// created task/block in sync) and completable right here.
export function ProjectsCard({ date }: { date: string }) {
  const { data: items = [] } = useActiveProjectItems(4)
  const setStatus = useSetProjectItemStatus()
  const [planning, setPlanning] = useState<ActiveProjectItem | null>(null)

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">📁 Projects</h3>
        <Link to="/projects" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Open →
        </Link>
      </div>

      {items.length === 0 ? (
        <Link to="/projects" className="text-xs text-accent-600 hover:text-accent-700 py-1.5">
          No active items — plan a project →
        </Link>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map(it => (
            <li key={it.id} className="flex items-center gap-2 group">
              <button
                onClick={() => setStatus.mutate({ id: it.id, status: 'done' })}
                title="Mark done"
                className="w-4 h-4 rounded-full border-2 border-ink-300 hover:border-green-500 hover:bg-green-100 transition-colors shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink-800 truncate leading-snug">
                  {it.title}
                  {it.status === 'in_progress' && <span className="ml-1.5 text-[9px] text-blue-600 font-semibold">active</span>}
                </p>
                <p className="text-[10px] text-ink-400 truncate flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${PRIO_DOT[it.priority] ?? PRIO_DOT.low} inline-block`} />
                  {it.project?.name ?? 'Project'}
                </p>
              </div>
              <button
                onClick={() => setPlanning(it)}
                className="text-[11px] px-2 py-1 rounded-lg border border-ink-200 text-ink-500 hover:border-accent-300 hover:text-accent-700 transition-colors shrink-0 min-h-[28px]"
              >
                📅
              </button>
            </li>
          ))}
        </ul>
      )}

      {planning && (
        <UnifiedPlanModal
          open
          onClose={() => setPlanning(null)}
          config={{ tabs: ['schedule', 'task'], heading: 'Plan project work' }}
          defaults={{ title: planning.title, date, category: 'daily', alsoCreateTask: true }}
          source={{ sourceType: 'project_item', sourceId: planning.id, taskSourceType: 'project_item' }}
          onSaved={() => setPlanning(null)}
        />
      )}
    </div>
  )
}
