import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  DEFAULT_STATE, EMPTY_FIELDS, isDraftEmpty, sameFields, sanitizeDraftState,
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

interface Actions {
  // New draft
  patchNewDraft: (patch: Partial<DraftFields & { attachContext: boolean }>) => void
  /** A fresh (empty) draft is re-stamped with the page it is started on. */
  beginNewDraft: (start: PageContext, page: string) => void
  resetNewDraft: () => void
  restoreNewDraft: (draft: PersistedDraftState['newDraft']) => void
  // Edits
  patchEditDraft: (id: string, patch: Partial<DraftFields>, seed: EditDraft) => void
  clearEditDraft: (id: string) => void
  /** Adds text to the end of the description of whatever `target` names. */
  appendToDescription: (target: ComposerTarget, block: string, seed?: EditDraft) => void
  // Composer
  openComposer: (target: ComposerTarget, tab?: ComposerTab) => void
  closeComposer: () => void
  setMinimized: (minimized: boolean) => void
  setComposerTab: (tab: ComposerTab) => void
  setComposerPos: (pos: { x: number; y: number } | null) => void
  // Drawer
  setDrawer: (patch: Partial<DrawerPrefs>) => void
  // Prompt
  setPrompt: (ids: string[], text: string) => void
  editPrompt: (text: string) => void
}

export type DraftStore = PersistedDraftState & Actions

export const useDevRequestDrafts = create<DraftStore>()(
  persist(
    (set, get) => ({
      ...sanitizeDraftState(DEFAULT_STATE),

      patchNewDraft: (patch) => set(s => ({ newDraft: { ...s.newDraft, ...patch } })),
      beginNewDraft: (start, page) => set(s => (
        isDraftEmpty(s.newDraft)
          ? { newDraft: { ...s.newDraft, ...EMPTY_FIELDS, category: s.newDraft.category, priority: s.newDraft.priority, page, start } }
          : s.newDraft.start ? s : { newDraft: { ...s.newDraft, start } }
      )),
      resetNewDraft: () => set({ newDraft: { ...EMPTY_FIELDS, start: null, attachContext: get().newDraft.attachContext } }),
      restoreNewDraft: (draft) => set({ newDraft: draft }),

      patchEditDraft: (id, patch, seed) => set(s => {
        const next = { ...(s.editDrafts[id] ?? seed), ...patch }
        const editDrafts = { ...s.editDrafts }
        // Back to what is saved: nothing left to keep.
        if (sameFields(next, seed)) delete editDrafts[id]
        else editDrafts[id] = next
        return { editDrafts }
      }),
      clearEditDraft: (id) => set(s => {
        if (!(id in s.editDrafts)) return s
        const editDrafts = { ...s.editDrafts }
        delete editDrafts[id]
        return { editDrafts }
      }),
      appendToDescription: (target, block, seed) => {
        const append = (d: string) => (d.replace(/\s+$/, '') ? `${d.replace(/\s+$/, '')}\n\n${block}` : block)
        if (target.kind === 'new') {
          set(s => ({ newDraft: { ...s.newDraft, description: append(s.newDraft.description) } }))
          return
        }
        const current = get().editDrafts[target.id] ?? seed
        if (!current) return
        set(s => ({ editDrafts: { ...s.editDrafts, [target.id]: { ...current, description: append(current.description) } } }))
      },

      openComposer: (target, tab = 'request') => set(s => ({ composer: { ...s.composer, open: true, minimized: false, target, tab } })),
      closeComposer: () => set(s => ({ composer: { ...s.composer, open: false, minimized: false } })),
      setMinimized: (minimized) => set(s => ({ composer: { ...s.composer, minimized } })),
      setComposerTab: (tab) => set(s => ({ composer: { ...s.composer, tab } })),
      setComposerPos: (pos) => set(s => ({ composer: { ...s.composer, pos } })),

      setDrawer: (patch) => set(s => ({ drawer: { ...s.drawer, ...patch } })),

      setPrompt: (ids, text) => set({ prompt: { ids, text, edited: false } }),
      editPrompt: (text) => set(s => ({ prompt: { ...s.prompt, text, edited: true } })),
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (s): PersistedDraftState => ({
        newDraft: s.newDraft, editDrafts: s.editDrafts, composer: s.composer, drawer: s.drawer, prompt: s.prompt,
      }),
      // Whatever was stored is validated field by field before it replaces
      // the defaults (an unreadable value falls back, the rest survives).
      merge: (persisted, current) => ({ ...current, ...sanitizeDraftState(persisted) }),
      migrate: (persisted) => sanitizeDraftState(persisted) as unknown as DraftStore,
    },
  ),
)

/** The fields a form shows for `target`: the draft, else the saved row (`seed`). */
export function fieldsFor(state: PersistedDraftState, target: ComposerTarget, seed?: EditDraft | null): DraftFields | null {
  if (target.kind === 'new') return state.newDraft
  return state.editDrafts[target.id] ?? seed ?? null
}
