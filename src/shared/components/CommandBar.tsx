import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { Search, Plus, CornerDownLeft, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../app/store'
import { NAV } from '../../app/navigation'
import { useTasksBySection, useCreateTask } from '../../features/todo/hooks/useTodos'
import { PRIORITY_TONE, DOMAIN_TONE } from '../../features/todo/taskTones'
import type { Task } from '../../features/todo/types'
import { ModalShell, useEntityModal } from '../modals'
import { ToneDot, TonePill } from '../ui'
import { withProgress } from '../hooks/useMutationWithFeedback'

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItem = { kind: 'nav'; id: string; label: string; icon: LucideIcon; path: string; terms: string }
type TaskItem = { kind: 'task'; id: string; label: string; domain: Task['domain']; priority: Task['priority'] }
type CreateItem = { kind: 'create'; id: 'create-task'; label: string; query: string }
type ResultItem = NavItem | TaskItem | CreateItem

// "Go to" targets come from the one navigation registry (src/app/navigation.ts).
const NAV_ITEMS: NavItem[] = NAV.map(e => ({
  kind: 'nav', id: e.id, label: e.label, icon: e.icon, path: e.path,
  terms: [e.label, ...(e.keywords ?? [])].join(' ').toLowerCase(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

const OPTION = 'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-row px-3 text-body text-fg-2 data-[focus]:bg-surface-hover data-[focus]:text-fg'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ⌘K palette: jump to a page, find a task (opens its editor), or quick-add
 * with "add <title>". A centred palette on wide screens, a sheet on phones.
 */
export function CommandBar() {
  const isOpen = useUIStore(s => s.isCommandBarOpen)
  const openBar = useUIStore(s => s.openCommandBar)
  const closeBar = useUIStore(s => s.closeCommandBar)

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) closeBar()
        else openBar()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, openBar, closeBar])

  return (
    <ModalShell
      open={isOpen}
      onClose={closeBar}
      size="lg"
      bodyClassName="p-0"
      panelClassName="sm:mt-[12vh] sm:self-start"
    >
      {/* Mounted only while open, so the query and task reads reset with it. */}
      <Palette onClose={closeBar} />
    </ModalShell>
  )
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const modal = useEntityModal()
  const createTask = useCreateTask()
  const [query, setQuery] = useState('')

  const todayTasks = useTasksBySection('today', true)
  const inboxTasks = useTasksBySection('inbox', true)

  const allTasks: Task[] = useMemo(() => {
    const seen = new Set<string>()
    return [...(todayTasks.data ?? []), ...(inboxTasks.data ?? [])].filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
  }, [todayTasks.data, inboxTasks.data])

  const trimmed = query.trim()
  const isQuickAdd = trimmed.toLowerCase().startsWith('add ')
  const addQuery = isQuickAdd ? trimmed.slice(4).trim() : ''
  const isSearching = trimmed.length >= 2 && !isQuickAdd

  const navResults = useMemo(() => {
    const q = trimmed.toLowerCase()
    return NAV_ITEMS.filter(n => !q || n.terms.includes(q))
  }, [trimmed])

  const taskResults = useMemo<TaskItem[]>(() => {
    if (!isSearching) return []
    return allTasks
      .filter(t => fuzzyMatch(t.title, trimmed))
      .slice(0, 8)
      .map(t => ({ kind: 'task', id: t.id, label: t.title, domain: t.domain, priority: t.priority }))
  }, [isSearching, allTasks, trimmed])

  async function handleSelect(item: ResultItem | null) {
    if (!item) return

    if (item.kind === 'nav') {
      // Replace the palette's own history entry (useHistoryDismiss) so one
      // Back from the new page returns to where the palette was opened.
      navigate(item.path, { replace: true })
      onClose()
      return
    }

    if (item.kind === 'task') {
      onClose()
      modal.open({ kind: 'task', id: item.id })
      return
    }

    if (!item.query) return
    // useCreateTask toasts + logs its own failures; this adds the per-call copy.
    const created = await withProgress(
      () => createTask.mutateAsync({ title: item.query, domain: 'personal', section: 'today', priority: 'medium' }),
      { loading: 'Creating task…', success: 'Task created' },
    )
    if (created !== undefined) onClose()
  }

  const showNav = !isQuickAdd && navResults.length > 0

  return (
    <Combobox onChange={handleSelect} onClose={() => {}}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4">
        <Search className="h-[18px] w-[18px] shrink-0 text-fg-muted" strokeWidth={2} aria-hidden />
        <ComboboxInput
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          displayValue={() => query}
          placeholder="Search tasks, jump to a page, or type “add …”"
          aria-label="Search or jump to"
          className="min-h-[56px] w-full bg-transparent text-lead font-medium text-fg placeholder:font-normal placeholder:text-fg-faint focus:outline-none"
        />
      </div>

      <ComboboxOptions static className="flex flex-col gap-px p-2 outline-none">
        {isQuickAdd && (
          <ComboboxOption
            value={{ kind: 'create', id: 'create-task', label: `Create task: ${addQuery}`, query: addQuery } as CreateItem}
            disabled={!addQuery}
            className={`${OPTION} data-[disabled]:cursor-default data-[disabled]:opacity-60`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600">
              <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {addQuery ? <>Create task: <span className="font-semibold text-fg">{addQuery}</span></> : <span className="text-fg-muted">Type a task title after “add ”</span>}
            </span>
          </ComboboxOption>
        )}

        {isSearching && (
          <>
            <p className="section-label px-3 pb-1 pt-2">Tasks</p>
            {taskResults.map(item => (
              <ComboboxOption key={item.id} value={item} className={OPTION}>
                <ToneDot tone={PRIORITY_TONE[item.priority]} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <TonePill tone={DOMAIN_TONE[item.domain]} className="shrink-0 capitalize">{item.domain}</TonePill>
              </ComboboxOption>
            ))}
            {taskResults.length === 0 && <p className="px-3 py-3 text-body text-fg-muted">No matching tasks in Today or Inbox.</p>}
          </>
        )}

        {showNav && (
          <>
            <p className="section-label px-3 pb-1 pt-2">Go to</p>
            {navResults.map(item => {
              const Icon = item.icon
              return (
                <ComboboxOption key={item.id} value={item} className={OPTION}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-2">
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="flex-1 font-medium">{item.label}</span>
                </ComboboxOption>
              )
            })}
          </>
        )}
      </ComboboxOptions>

      <div className="hidden items-center justify-end gap-3 border-t border-line px-4 py-2 text-meta text-fg-faint sm:flex">
        <span>↑↓ navigate</span>
        <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden /> select</span>
        <span>Esc close</span>
      </div>
    </Combobox>
  )
}
