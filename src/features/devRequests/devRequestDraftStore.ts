import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  DEFAULT_STATE, EMPTY_FIELDS, isDraftEmpty, mergeDraftContent, sameDraftContent, sameFields, sanitizeDraftState,
  type ComposerTab, type ComposerTarget, type DraftFields, type DrawerPrefs, type EditDraft, type PersistedDraftState,
} from './devRequestRules'
import type { PageContext } from './devRequestContext'

// Everything the requests backlog must not lose: the new request being
// written, unsaved edits of existing ones, the floating composer (open,
// minimised, where it sits), the drawer's filters and the prompt for Claude.
// Before this, the drawer's form kept its text in component state, and the
// drawer (a Headless UI Dialog) unmounts its content on close — so a click
// outside, Esc or Back threw a half-written request away.
//
// localStorage, this device only (owner decision). Writes are debounced
// (typing would otherwise serialise the store on every keystroke — slow on
// iOS) and flushed when the page is hidden; every storage access is guarded,
// since private mode or blocked storage throws.
//
// Several tabs (or the installed app next to a browser tab) share the key.
// Each draft carries the time of its last change, and a write from another
// tab is merged in draft by draft, the later change winning — so a tab opened
// earlier can never write its older copy over what you typed elsewhere.

const KEY = 'lasci.devRequests'
const WRITE_DELAY_MS = 300

const pending = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  for (const [k, v] of pending) {
    try { localStorage.setItem(k, v) } catch { /* blocked or full: the in-memory state still works */ }
  }
  pending.clear()
}

const debouncedStorage: StateStorage = {
  getItem: (name) => {
    if (pending.has(name)) return pending.get(name)!
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name, value) => {
    pending.set(name, value)
    if (!timer) timer = setTimeout(flush, WRITE_DELAY_MS)
  },
  removeItem: (name) => {
    pending.delete(name)
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

/** Where keyboard focus should go next: into the composer window, or onto its pill. */
export interface FocusRequest { n: number; to: 'window' | 'pill' }

interface Actions {
  // New draft
  patchNewDraft: (patch: Partial<DraftFields & { attachContext: boolean }>) => void
  /** A fresh (empty) draft is re-stamped with the page it is started on. */
  beginNewDraft: (start: PageContext, page: string) => void
  /** Empties the new draft; `restart` stamps the empty one with the page it now belongs to. */
  resetNewDraft: (restart?: { start: PageContext; page: string }) => void
  restoreNewDraft: (draft: PersistedDraftState['newDraft']) => void
  // Edits
  patchEditDraft: (id: string, patch: Partial<DraftFields>, seed: EditDraft) => void
  clearEditDraft: (id: string) => void
  /** Drops the edit drafts of requests that no longer exist. */
  pruneEditDrafts: (ids: readonly string[]) => void
  /** Adds text to the end of the description of whatever `target` names. */
  /** Rewrites a request's description (a new pick link, …). */
  editDescription: (target: ComposerTarget, edit: (description: string) => string, seed?: EditDraft) => void
  // Composer
  openComposer: (target: ComposerTarget, tab?: ComposerTab) => void
  closeComposer: () => void
  setMinimized: (minimized: boolean) => void
  setComposerTab: (tab: ComposerTab) => void
  setComposerPos: (pos: { x: number; y: number } | null) => void
  /** The window's size for one view (null = back to its default). */
  setComposerSize: (view: ComposerTab, size: { w: number; h: number } | null) => void
  // Drawer
  setDrawer: (patch: Partial<DrawerPrefs>) => void
  // Prompt
  setPrompt: (ids: string[], text: string) => void
  editPrompt: (text: string) => void
}

/** Not persisted: bumped by the actions that should move focus. */
interface Transient { focus: FocusRequest }

export type DraftStore = PersistedDraftState & Actions & Transient

const withoutKeys = <T,>(record: Record<string, T>, keys: readonly string[]) => {
  const next = { ...record }
  for (const k of keys) delete next[k]
  return next
}
const tombstones = (record: Record<string, number>, keys: readonly string[], at: number) => {
  const next = { ...record }
  for (const k of keys) next[k] = at
  return next
}

export const useDevRequestDrafts = create<DraftStore>()(
  persist(
    (set, get) => ({
      ...sanitizeDraftState(DEFAULT_STATE),
      focus: { n: 0, to: 'window' },

      patchNewDraft: (patch) => set(s => ({ newDraft: { ...s.newDraft, ...patch, touchedAt: Date.now() } })),
      // Not a change the user made (no new stamp): an empty draft on one tab
      // must never outrank text typed on another.
      beginNewDraft: (start, page) => set(s => (
        isDraftEmpty(s.newDraft)
          ? { newDraft: { ...s.newDraft, ...EMPTY_FIELDS, category: s.newDraft.category, priority: s.newDraft.priority, page, start } }
          : s.newDraft.start ? s : { newDraft: { ...s.newDraft, start } }
      )),
      resetNewDraft: (restart) => set(s => ({
        newDraft: {
          ...EMPTY_FIELDS,
          ...(restart ? { page: restart.page, category: s.newDraft.category, priority: s.newDraft.priority } : {}),
          start: restart?.start ?? null,
          attachContext: s.newDraft.attachContext,
          touchedAt: Date.now(),
        },
      })),
      restoreNewDraft: (draft) => set({ newDraft: { ...draft, touchedAt: Date.now() } }),

      patchEditDraft: (id, patch, seed) => set(s => {
        const now = Date.now()
        const next = { ...(s.editDrafts[id] ?? seed), ...patch, touchedAt: now }
        // Back to what is saved: nothing left to keep.
        if (sameFields(next, seed)) {
          return { editDrafts: withoutKeys(s.editDrafts, [id]), clearedEdits: tombstones(s.clearedEdits, [id], now) }
        }
        return { editDrafts: { ...s.editDrafts, [id]: next } }
      }),
      clearEditDraft: (id) => get().pruneEditDrafts([id]),
      pruneEditDrafts: (ids) => set(s => {
        const gone = ids.filter(id => id in s.editDrafts)
        if (gone.length === 0) return s
        return { editDrafts: withoutKeys(s.editDrafts, gone), clearedEdits: tombstones(s.clearedEdits, gone, Date.now()) }
      }),
      editDescription: (target, edit, seed) => {
        if (target.kind === 'new') {
          set(s => ({ newDraft: { ...s.newDraft, description: edit(s.newDraft.description), touchedAt: Date.now() } }))
          return
        }
        const current = get().editDrafts[target.id] ?? seed
        if (!current) return
        set(s => ({ editDrafts: { ...s.editDrafts, [target.id]: { ...current, description: edit(current.description), touchedAt: Date.now() } } }))
      },

      openComposer: (target, tab = 'request') => set(s => ({
        composer: { ...s.composer, open: true, minimized: false, target, tab },
        focus: { n: s.focus.n + 1, to: 'window' },
      })),
      closeComposer: () => set(s => ({ composer: { ...s.composer, open: false, minimized: false } })),
      setMinimized: (minimized) => set(s => ({
        composer: { ...s.composer, minimized },
        focus: { n: s.focus.n + 1, to: minimized ? 'pill' : 'window' },
      })),
      setComposerTab: (tab) => set(s => ({ composer: { ...s.composer, tab } })),
      setComposerPos: (pos) => set(s => ({ composer: { ...s.composer, pos } })),
      setComposerSize: (view, size) => set(s => ({ composer: { ...s.composer, size: { ...s.composer.size, [view]: size } } })),

      setDrawer: (patch) => set(s => ({ drawer: { ...s.drawer, ...patch } })),

      setPrompt: (ids, text) => set({ prompt: { ids, text, edited: false, touchedAt: Date.now() } }),
      editPrompt: (text) => set(s => ({ prompt: { ...s.prompt, text, edited: true, touchedAt: Date.now() } })),
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (s): PersistedDraftState => ({
        newDraft: s.newDraft, editDrafts: s.editDrafts, clearedEdits: s.clearedEdits, composer: s.composer, drawer: s.drawer, prompt: s.prompt,
      }),
      // Whatever was stored is validated field by field before it replaces
      // the defaults (an unreadable value falls back, the rest survives).
      merge: (persisted, current) => ({ ...current, ...sanitizeDraftState(persisted) }),
      migrate: (persisted) => sanitizeDraftState(persisted) as unknown as DraftStore,
    },
  ),
)

// Another tab wrote the drafts: take its newer changes. When this tab holds
// newer text than what was just written, write it back, so the stored copy
// is never the older one (closing this tab next would otherwise lose it).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || e.newValue == null) return
    let incoming: PersistedDraftState
    try { incoming = sanitizeDraftState((JSON.parse(e.newValue) as { state?: unknown } | null)?.state) } catch { return }
    const local = useDevRequestDrafts.getState()
    const merged = mergeDraftContent(local, incoming)
    if (merged !== local) useDevRequestDrafts.setState(merged)
    else if (!sameDraftContent(local, incoming)) useDevRequestDrafts.setState({})
  })
}
