// A quick add anywhere (step 3 of docs/features/item-screen-plan.md: Work's quick add and the search bar's "add …",
// as Home's): the text is read by the one parser (quickAdd.ts — "Gym 17:30 1h every Mon"), Enter adds it at once
// through the one item save (useSaveItem: one RPC, its own result line and Undo), and "Open" takes the text to the item
// screen instead, where its title reads it the same way. One hook, so every quick add saves the same item.
import { useItemCalendarApp } from '../calendar/areas/useItemCalendarApp'
import { useCalendarStore } from '../../app/store'
import { entityModal } from '../../shared/modals'
import { itemFromQuickAdd } from './sheetRules'
import { useSaveItem } from './useItems'
import type { QuickAddResult } from './quickAdd'
import type { TaskDomain } from '../todo/types'

export function useQuickAdd(domain: TaskDomain) {
  // The result line names the calendar of the item's area (Work's is Work's).
  const calendarApp = useItemCalendarApp({ domain })
  const save = useSaveItem({ calendarApp })
  const googleConnected = !!useCalendarStore(s => s.accessToken)

  /** Adds the text now, as read (`parse`: null = the words as typed). Resolves false when there was nothing to add or
   *  the save failed (the save's own toast said why). */
  async function add(text: string, parse: QuickAddResult | null, day: string): Promise<boolean> {
    // With no Google connection here, a timed item in an area on Apple Calendar still goes there (as Home's).
    const input = itemFromQuickAdd(text, parse, day, googleConnected, calendarApp === 'apple', domain)
    if (!input) return false
    return save.mutateAsync(input).then(() => true, () => false)
  }

  /** The item screen for a new item with this text in its title — read there as typed, unless "Keep text" was picked. */
  function open(text: string, keepText: boolean, day: string): void {
    const t = text.trim()
    entityModal.open({ kind: 'task', defaults: { domain, date: day, ...(t ? (keepText ? { title: t } : { typed: t }) : {}) } })
  }

  return { add, open, busy: save.isPending }
}
