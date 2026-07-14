import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Combobox,
  ComboboxInput,
  ComboboxOptions,
  ComboboxOption,
} from '@headlessui/react'
import { useUIStore, toast } from '../../app/store'
import { useTasksBySection, useCreateTask } from '../../features/todo/hooks/useTodos'
import type { Task } from '../../features/todo/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItem = {
  kind: 'nav'
  id:   string
  label: string
  icon:  string
  path:  string
}

type TaskItem = {
  kind:  'task'
  id:    string
  label: string
  domain: Task['domain']
  priority: Task['priority']
}

type CreateItem = {
  kind:  'create'
  id:    'create-task'
  label: string
  query: string
}

type ResultItem = NavItem | TaskItem | CreateItem

// ─── Constants ────────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { kind: 'nav', id: 'home',      label: 'Home',      icon: '🏠', path: '/home'      },
  { kind: 'nav', id: 'daily',     label: 'Daily',     icon: '📅', path: '/daily'     },
  { kind: 'nav', id: 'shop',      label: 'Shop',      icon: '🛍️', path: '/shop'      },
  { kind: 'nav', id: 'recipes',   label: 'Recipes',   icon: '🍳', path: '/recipes'   },
  { kind: 'nav', id: 'work',      label: 'Work',      icon: '💼', path: '/work'      },
  { kind: 'nav', id: 'media',     label: 'Media',     icon: '🎬', path: '/media'     },
  { kind: 'nav', id: 'training',  label: 'Training',  icon: '🏃', path: '/training'  },
  { kind: 'nav', id: 'projects',  label: 'Projects',  icon: '📁', path: '/projects'  },
  { kind: 'nav', id: 'games',     label: 'Games',     icon: '🎮', path: '/games'     },
]

const DOMAIN_COLORS: Record<Task['domain'], string> = {
  personal: 'bg-blue-100 text-blue-700',
  work:     'bg-purple-100 text-purple-700',
  media:    'bg-pink-100 text-pink-700',
}

const PRIORITY_COLORS: Record<Task['priority'], string> = {
  high:   'bg-red-400',
  medium: 'bg-yellow-400',
  low:    'bg-green-400',
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandBar() {
  const isOpen       = useUIStore(s => s.isCommandBarOpen)
  const openBar      = useUIStore(s => s.openCommandBar)
  const closeBar     = useUIStore(s => s.closeCommandBar)
  const navigate     = useNavigate()
  const createTask   = useCreateTask()

  const [query, setQuery] = useState('')

  // Reset query when bar opens/closes
  useEffect(() => { if (!isOpen) setQuery('') }, [isOpen])

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        isOpen ? closeBar() : openBar()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, openBar, closeBar])

  // Task queries — enabled only when bar is open
  const todayTasks = useTasksBySection('today', isOpen)
  const inboxTasks = useTasksBySection('inbox', isOpen)

  const allTasks: Task[] = useMemo(() => {
    const today = todayTasks.data ?? []
    const inbox = inboxTasks.data ?? []
    // deduplicate by id
    const seen = new Set<string>()
    return [...today, ...inbox].filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
  }, [todayTasks.data, inboxTasks.data])

  const trimmed       = query.trim()
  const isQuickAdd    = trimmed.toLowerCase().startsWith('add ')
  const addQuery      = isQuickAdd ? trimmed.slice(4).trim() : ''
  const isSearching   = trimmed.length >= 2 && !isQuickAdd

  // Build result list
  const results: ResultItem[] = useMemo(() => {
    if (isQuickAdd) {
      const createItem: CreateItem = {
        kind:  'create',
        id:    'create-task',
        label: addQuery ? `Create task: ${addQuery}` : 'Type a task title after "add "',
        query: addQuery,
      }
      return [createItem]
    }

    if (isSearching) {
      const matched = allTasks
        .filter(t => fuzzyMatch(t.title, trimmed))
        .slice(0, 8)
        .map<TaskItem>(t => ({
          kind:     'task',
          id:       t.id,
          label:    t.title,
          domain:   t.domain,
          priority: t.priority,
        }))
      return matched
    }

    // Default: nav items (optionally filtered by query)
    const q = trimmed.toLowerCase()
    return NAV_ITEMS.filter(n => !q || n.label.toLowerCase().includes(q))
  }, [isQuickAdd, isSearching, addQuery, trimmed, allTasks])

  // ─── Selection handler ────────────────────────────────────────────────────

  async function handleSelect(item: ResultItem | null) {
    if (!item) return

    if (item.kind === 'nav') {
      navigate(item.path)
      closeBar()
      return
    }

    if (item.kind === 'task') {
      // Tasks have no detail page — just close the bar
      closeBar()
      return
    }

    if (item.kind === 'create') {
      if (!item.query) return
      const tid = toast.loading('Creating task…')
      try {
        await createTask.mutateAsync({
          title:    item.query,
          domain:   'personal',
          section:  'today',
          priority: 'medium',
        })
        toast.dismiss(tid)
        toast.success('Task created ✓')
        closeBar()
      } catch (err) {
        toast.dismiss(tid)
        toast.error((err as Error).message ?? 'Failed to create task')
      }
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={isOpen} onClose={closeBar} className="relative z-[70]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-950/50 transition duration-150 data-[closed]:opacity-0"
      />

      <div className="fixed inset-0 pointer-events-none">
        <DialogPanel
          transition
          className="pointer-events-auto fixed top-[15vh] left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto transition duration-150 data-[closed]:opacity-0 data-[closed]:-translate-y-2"
        >
          <div className="bg-cream-50 rounded-2xl shadow-2xl border border-ink-200 overflow-hidden">
            <Combobox onChange={handleSelect} onClose={() => {}}>
              {/* Input */}
              <div className="border-b-2 border-ink-200">
                <ComboboxInput
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  displayValue={() => query}
                  placeholder="Search or jump to…"
                  className="w-full text-lg px-4 py-3 bg-transparent focus:outline-none text-ink-900 placeholder:text-ink-300 min-h-[44px]"
                />
              </div>

              {/* Results */}
              <ComboboxOptions static className="max-h-80 overflow-y-auto">
                {/* Group header */}
                {!isQuickAdd && (
                  <div className="text-[10px] uppercase tracking-wider text-ink-400 px-4 py-1.5 select-none">
                    {isSearching ? 'Tasks' : 'Go to'}
                  </div>
                )}

                {/* Quick-add item */}
                {isQuickAdd && (
                  <ComboboxOption
                    value={{ kind: 'create', id: 'create-task', label: `Create task: ${addQuery}`, query: addQuery } as CreateItem}
                    disabled={!addQuery}
                    className="px-4 py-2.5 flex items-center gap-3 cursor-pointer data-[focus]:bg-cream-100 min-h-[44px] data-[disabled]:opacity-50 data-[disabled]:cursor-default"
                  >
                    <span className="text-xl flex-shrink-0">➕</span>
                    <span className="text-ink-800 text-sm flex-1">
                      {addQuery ? (
                        <>Create task: <span className="font-medium">{addQuery}</span></>
                      ) : (
                        <span className="text-ink-400">Type a task title after "add "</span>
                      )}
                    </span>
                  </ComboboxOption>
                )}

                {/* Nav results */}
                {!isQuickAdd && !isSearching && (results as NavItem[]).map(item => (
                  <ComboboxOption
                    key={item.id}
                    value={item}
                    className="px-4 py-2.5 flex items-center gap-3 cursor-pointer data-[focus]:bg-cream-100 min-h-[44px]"
                  >
                    <span className="text-xl flex-shrink-0 w-7 text-center">{item.icon}</span>
                    <span className="text-ink-800 text-sm font-medium flex-1">{item.label}</span>
                  </ComboboxOption>
                ))}

                {/* Task search results */}
                {isSearching && (results as TaskItem[]).map(item => (
                  <ComboboxOption
                    key={item.id}
                    value={item}
                    className="px-4 py-2.5 flex items-center gap-3 cursor-pointer data-[focus]:bg-cream-100 min-h-[44px]"
                  >
                    {/* Priority dot */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`} />
                    <span className="text-ink-800 text-sm flex-1 truncate">{item.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${DOMAIN_COLORS[item.domain]}`}>
                      {item.domain}
                    </span>
                  </ComboboxOption>
                ))}

                {/* Empty state */}
                {isSearching && results.length === 0 && (
                  <div className="px-4 py-6 text-center text-ink-400 text-sm select-none">
                    No results
                  </div>
                )}
              </ComboboxOptions>

              {/* Footer hint */}
              <div className="border-t border-ink-100 px-4 py-2 flex items-center justify-end">
                <span className="text-[10px] text-ink-300 select-none">
                  ↑↓ navigate · Enter select · Esc close
                </span>
              </div>
            </Combobox>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
