import { Fragment, type ReactNode } from 'react'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { dealByIndex, phaseColumnCount } from '../projectBoard'

/**
 * The project's phases, dealt into column stacks by index (projectBoard.ts):
 * phase i goes to column i mod N, N from this area's own width. Each column
 * is a stack, so a phase's place never depends on how long its neighbours
 * are and a short phase never leaves a hole beside a long one. Pass "Add
 * phase" as the last item: it lands where the next phase will appear.
 */
export function PhaseColumns({ items }: { items: { key: string; node: ReactNode }[] }) {
  const { ref, width } = useElementWidthRem<HTMLDivElement>()
  const count = width == null ? 1 : phaseColumnCount(width)
  const columns = dealByIndex(items, count)
  return (
    <div ref={ref} className="grid items-start gap-3" style={{ gridTemplateColumns: `repeat(${count},minmax(0,1fr))` }}>
      {columns.map((column, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-3">
          {column.map(item => <Fragment key={item.key}>{item.node}</Fragment>)}
        </div>
      ))}
    </div>
  )
}
