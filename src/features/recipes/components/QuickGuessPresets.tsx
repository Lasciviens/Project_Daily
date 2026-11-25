import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton, Truncate, cx } from '../../../shared/ui'
import { DragReorderList } from '../../../shared/ui/dragReorder/DragReorderList'
import { moveItem } from '../../../shared/ui/dragReorder/dragReorderModel'
import { useDragReorderRow } from '../../../shared/ui/dragReorder/dragReorderRow'
import { ReorderControls } from '../../../shared/ui/dragReorder/ReorderControls'
import { useMoveQuickGuess, useQuickGuessItems } from '../hooks/useQuickGuess'
import { nextSortOrder, type QuickGuessItem } from '../quickGuess'
import { foodEmoji } from './foodLogUtils'
import { QuickGuessSheet } from './QuickGuessEditor'
import { BUILT_IN_ITEMS } from './quickGuessBuiltIn'

// Settings → Food loads this list on demand (FoodTab): its drag (@dnd-kit)
// stays out of Settings' first download and out of the sheet's importers.

/**
 * Settings → Food → Quick guess: the presets Food · Today's Quick guess card
 * offers (quick_guess_items, migration 152). Tap one to edit it (delete is in
 * there, with Undo), move it with the arrows, add one at the end.
 */
export function QuickGuessEditor({ onClose }: { onClose: () => void }) {
  const q = useQuickGuessItems()
  const move = useMoveQuickGuess()
  const [editing, setEditing] = useState<QuickGuessItem | 'new' | null>(null)
  const migrated = q.data !== null
  const items = q.data ?? (q.data === null ? BUILT_IN_ITEMS : [])

  // Before migration 152 the built-in presets are no rows: nothing to reorder.
  const reorder = (from: number, to: number) => move.save(moveItem(items, from, to))

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      title="Quick guess"
      subtitle="The one-tap chips on Food · Today"
      footer={
        <div className="flex justify-between gap-2">
          <Button icon={<Plus />} onClick={() => setEditing('new')} disabled={q.isLoading || q.isError}>Add</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      {!migrated && (
        <p className="mb-2 text-meta text-fg-muted">These are the built-in presets. Saving your own needs migration 152 — until it runs, a save says so.</p>
      )}
      {q.isError && (
        <p className="text-meta text-fg-muted">Your presets didn't load. <button type="button" onClick={() => { void q.refetch() }} className="font-semibold text-accent-600">Try again</button></p>
      )}
      {q.isLoading && <div className="flex flex-col gap-1.5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>}
      {q.data?.length === 0 && <p className="text-meta text-fg-muted">No presets. Add the things you often eat but can't weigh.</p>}
      <div className="@container -mx-2">
        <DragReorderList ids={items.map(i => i.id)} onMove={reorder} disabled={!migrated} label="Quick guess presets"
          nameOf={id => items.find(i => i.id === id)?.name ?? 'The preset'} className="flex flex-col">
          {items.map(item => <QuickGuessRow key={item.id} item={item} disabled={!migrated} onEdit={() => setEditing(item)} />)}
        </DragReorderList>
      </div>
      {editing && (
        <QuickGuessSheet key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing}
          sortOrder={nextSortOrder(items)} onClose={() => setEditing(null)} />
      )}
    </ModalShell>
  )
}

/** One preset: tap to edit; it drags by itself (on touch: hold, then drag), never from its buttons. */
function QuickGuessRow({ item, disabled, onEdit }: { item: QuickGuessItem; disabled: boolean; onEdit: () => void }) {
  const row = useDragReorderRow(item.id)
  return (
    <li {...row.rowProps} className={cx(row.rowClassName, 'flex items-center gap-0.5 rounded-row pr-1', row.dragging ? 'bg-surface shadow-menu' : 'hover:bg-surface-hover')}>
      <button type="button" onClick={onEdit} aria-label={`Edit ${item.name}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-2 py-1 text-left">
        <span aria-hidden className="w-6 shrink-0 text-center text-base leading-none">{item.icon || foodEmoji(item.name)}</span>
        <span className="min-w-0 flex-1">
          <Truncate className="text-body font-medium text-fg">{item.name}</Truncate>
          {/* One line: kcal and protein (what the chip shows), then its option groups, or carbs and fat where the popup is wider. */}
          <p className="whitespace-nowrap text-meta tabular-nums text-fg-muted">
            {item.calories} kcal · {item.protein_g} g protein
            {item.options.length > 0
              ? <> · <span className="text-fg-2">{item.options.length === 1 ? '1 option group' : `${item.options.length} option groups`}</span></>
              : <span className="hidden sm:inline"> · {item.carbs_g} g carbs · {item.fat_g} g fat</span>}
          </p>
        </span>
      </button>
      <div data-no-drag="" className="flex shrink-0 cursor-auto items-center text-fg-muted">
        <ReorderControls name={item.name} index={row.index} count={row.count} onMove={row.move} disabled={disabled} wide="26rem" />
      </div>
    </li>
  )
}
