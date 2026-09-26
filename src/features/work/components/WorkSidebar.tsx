import { useState, type ReactNode } from 'react'
import { BarChart3, ChevronDown, Link2, NotebookPen, Target } from 'lucide-react'
import type { Task } from '../../todo/types'
import { cx } from '../../../shared/ui'
import QuickNotesWidget from './QuickNotesWidget'
import WeeklyGoalsWidget from './WeeklyGoalsWidget'
import PinnedLinksWidget from './PinnedLinksWidget'
import EODSummaryWidget from './EODSummaryWidget'

// Right rail — everything visible at once as stacked collapsible cards
// (replaces the old tabbed sidebar where 3 of the 4 tools were always hidden).
// Collapse state persists per section.

function usePersistedCollapse(key: string, defaultCollapsed = false) {
  const storageKey = `work_rail_${key}`
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw !== null ? raw === '1' : defaultCollapsed
    } catch { return defaultCollapsed }
  })
  function toggle() {
    setCollapsed(prev => {
      try { localStorage.setItem(storageKey, prev ? '0' : '1') } catch { /* ignore */ }
      return !prev
    })
  }
  return { collapsed, toggle }
}

function RailSection({ id, title, icon, defaultCollapsed, children }: {
  id: string
  title: string
  icon: ReactNode
  defaultCollapsed?: boolean
  children: ReactNode
}) {
  const { collapsed, toggle } = usePersistedCollapse(id, defaultCollapsed)
  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors [@media(hover:hover)]:hover:bg-surface-hover"
      >
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <span className="flex-1 text-lead font-semibold text-fg">{title}</span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-faint transition-transform', collapsed && '-rotate-90')} />
      </button>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

// Explicit steps so cards never jump: one column on phones, a 2/4-up row
// under the board on tablets and laptops, one column in the 2xl side rail.
export default function WorkSidebar({ tasks }: { tasks: Task[] }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-1">
      <RailSection id="summary" title="Today" icon={<BarChart3 />}>
        <EODSummaryWidget tasks={tasks} />
      </RailSection>
      <RailSection id="notes" title="Notes" icon={<NotebookPen />}>
        <QuickNotesWidget />
      </RailSection>
      <RailSection id="goals" title="This week" icon={<Target />}>
        <WeeklyGoalsWidget />
      </RailSection>
      <RailSection id="links" title="Pinned links" icon={<Link2 />} defaultCollapsed>
        <PinnedLinksWidget />
      </RailSection>
    </div>
  )
}
