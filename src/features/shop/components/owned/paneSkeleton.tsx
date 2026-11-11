import { Skeleton } from '../../../../shared/ui'

/** The side pane's height: the scroll area less the sticky rail's 1rem above and below it (PageBoard's StickyStack). */
export const PANE_HEIGHT = 'max-h-[calc(100dvh-7rem)]'

/**
 * The side pane while its code or its row loads (Owned, from 60rem): its
 * frame at its height, so the rail keeps its size when the record fills it.
 */
export function RecordPaneSkeleton() {
  return (
    <div aria-busy="true" className={`card flex h-[calc(100dvh-7rem)] ${PANE_HEIGHT} flex-col gap-3 overflow-hidden p-4`}>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-9 w-1/2" />
      <div className="grid grid-cols-2 gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[4.25rem]" />)}</div>
      <Skeleton rounded="rounded-row" className="h-10 w-full" />
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-4 w-5/6" />)}
    </div>
  )
}
