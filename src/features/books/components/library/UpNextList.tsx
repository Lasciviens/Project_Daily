import { cx } from '../../../../shared/ui'
import { DragReorderList } from '../../../../shared/ui/dragReorder/DragReorderList'
import { moveItem } from '../../../../shared/ui/dragReorder/dragReorderModel'
import { useDragReorderRow } from '../../../../shared/ui/dragReorder/dragReorderRow'
import { ReorderControls } from '../../../../shared/ui/dragReorder/ReorderControls'
import { useSaveQueueOrder } from '../../hooks/useLibrary'
import type { Book } from '../../types'
import { UpNextBook } from './UpNextBook'

/** Up next's rows on the shared drag: every move (a drop, ↑ ↓, Top, Alt+↑/↓) is one save of the order. */
export function UpNextList({ queue, shown, title, onOpen }: { queue: Book[]; shown: Book[]; title: string; onOpen: (b: Book) => void }) {
  const order = useSaveQueueOrder()
  // The shown rows are the queue's first ones, so a place in the list is its place in the queue.
  const move = (from: number, to: number) => order.save(moveItem(queue, from, to))
  return (
    <>
      <DragReorderList ids={shown.map(b => b.id)} onMove={move} label={title}
        nameOf={id => queue.find(b => b.id === id)?.title ?? 'The book'} className="flex flex-col gap-1">
        {shown.map(b => <UpNextRow key={b.id} book={b} onOpen={() => onOpen(b)} />)}
      </DragReorderList>
      {order.saving && <span className="sr-only" aria-live="polite">Saving the order…</span>}
    </>
  )
}

/** One book: it drags by itself (number, cover, title), never from its buttons. */
function UpNextRow({ book: b, onOpen }: { book: Book; onOpen: () => void }) {
  const row = useDragReorderRow(b.id)
  return (
    <li {...row.rowProps} className={cx(row.rowClassName, 'flex items-center gap-2 rounded-control', row.dragging && 'bg-surface shadow-menu')}>
      <UpNextBook book={b} place={row.place} dragging={row.dragging} onOpen={onOpen} />
      <div data-no-drag="" className="flex shrink-0 cursor-auto items-center">
        <ReorderControls name={b.title} index={row.index} count={row.count} onMove={row.move} wide="26rem" top />
      </div>
    </li>
  )
}
