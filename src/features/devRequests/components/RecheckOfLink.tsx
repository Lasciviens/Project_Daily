import { CornerUpLeft } from 'lucide-react'
import type { RecheckOf } from '../devRequestMarks'
import { cleanText } from '../devRequestContext'
import { Truncate } from '../../../shared/ui'

/** On a re-check request: "Re-check of “Home tweaks”" — opens the original. */
export function RecheckOfLink({ recheck, onOpen }: { recheck: RecheckOf | null; onOpen: (id: string) => void }) {
  if (!recheck) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(recheck.of)}
      title="Open the request these points first came from"
      className="flex min-h-[32px] min-w-0 max-w-full items-center [@media(pointer:coarse)]:min-h-[44px]"
    >
      <span data-tone="info" className="tone-pill gap-1">
        <CornerUpLeft aria-hidden className="h-3 w-3 shrink-0" />
        <Truncate className="min-w-0">{`Re-check of “${cleanText(recheck.title, 40) || 'a request'}”`}</Truncate>
      </span>
    </button>
  )
}
