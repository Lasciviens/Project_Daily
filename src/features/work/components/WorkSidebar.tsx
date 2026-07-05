import { useState, type ReactNode } from 'react'
import type { Task } from '../../todo/types'
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

function RailSection({ id, title, defaultCollapsed, children }: {
  id: string
  title: string
  defaultCollapsed?: boolean
  children: ReactNode
}) {
  const { collapsed, toggle } = usePersistedCollapse(id, defaultCollapsed)
  return (
    <div className="rounded-xl border border-ink-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] hover:bg-cream-50 transition-colors"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-500">{title}</span>
        <span className="text-[10px] text-ink-300">{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

export default function WorkSidebar({ tasks }: { tasks: Task[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <RailSection id="summary" title="📊 Today's Summary">
        <EODSummaryWidget tasks={tasks} bare />
      </RailSection>
      <RailSection id="notes" title="📝 Notes">
        <QuickNotesWidget bare />
      </RailSection>
      <RailSection id="goals" title="🎯 This Week">
        <WeeklyGoalsWidget bare />
      </RailSection>
      <RailSection id="links" title="🔗 Pinned Links" defaultCollapsed>
        <PinnedLinksWidget bare />
      </RailSection>
    </div>
  )
}
