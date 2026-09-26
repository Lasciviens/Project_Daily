import { EyeOff } from 'lucide-react'
import { hiddenNote } from './tgAnalyticsDrillCopy'
import { useAnalyticsHandoff } from './tgAnalyticsHandoff'
import { hiddenGames } from './tgAnalyticsLists'

/**
 * One muted line under the tiles: hidden titles are left out of every figure
 * on this screen, and this says how many and why — with a way to see them.
 */
export function TgAnalyticsHiddenNote({ hidden }: { hidden: { total: number; explicit: number; auto: number } }) {
  const handoff = useAnalyticsHandoff()
  if (hidden.total === 0) return null
  return (
    <p className="-mt-2 text-[12px] leading-relaxed text-[var(--tg-muted)]">
      <EyeOff size={13} strokeWidth={2} aria-hidden className="mr-1.5 inline-block align-[-2px] text-[var(--tg-faint)]" />
      {hiddenNote(hidden)}.{' '}
      {/* A 44px target on touch without stretching the line: the negative margin gives the height back. */}
      <button
        type="button"
        onClick={() => { const b = handoff.base; if (b) handoff.open('Hidden', hiddenGames(b.games, b.library), { status: 'hidden', wholeLibrary: true }) }}
        aria-label="Show the hidden titles in the library"
        className="inline-flex items-center rounded-md px-1 align-middle font-semibold text-[var(--tg-accent)] underline-offset-2 [@media(hover:hover)]:hover:underline [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-2"
      >
        Show
      </button>
    </p>
  )
}
