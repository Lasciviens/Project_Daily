import { useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { X } from 'lucide-react'
import { formatDay, type TgGame } from '../testGameModel'
import { useTgBreakpoint } from '../useTgBreakpoint'
import { TGA_LIBRARIES, tileGames, type TgaLibrary, type TgaTile } from './tgAnalyticsModel'
import { drillFigure, drillNote, drillTitle, shownOf } from './tgAnalyticsDrillCopy'
import { openGameFromAnalytics } from './tgAnalyticsOpen'
import { TgAnalyticsDrillList } from './TgAnalyticsDrillList'
import { TgMobileSheet } from './TgMobileSheet'

// A KPI tile's drill-down: exactly the games its number counts, under the
// current window × library. The list comes from tileGames — the same function
// the tile's figure is computed from — so it always adds up.

const PAGE = 100

function Body({ kind, games, windowed, scope, onPick }: {
  kind: TgaTile; games: TgGame[]; windowed: boolean; scope: string; onPick: (id: string) => void
}) {
  const [limit, setLimit] = useState(PAGE)
  return (
    <>
      <p className="text-[15px] font-semibold tabular-nums text-[var(--tg-text)]">{drillFigure(kind, games)}</p>
      <p className="mt-0.5 text-[12px] text-[var(--tg-muted)]">{scope}</p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--tg-text-2)]">{drillNote(kind, windowed)}</p>
      <div className="mt-3 -mx-2">
        {games.length
          ? <TgAnalyticsDrillList kind={kind} games={games.slice(0, limit)} onPick={onPick} />
          : <p className="px-2 py-6 text-center text-[13px] text-[var(--tg-muted)]">No games count towards this figure.</p>}
      </div>
      {games.length > limit && (
        <div className="mt-3 flex items-center justify-between gap-3 pb-2">
          <span className="text-[12px] text-[var(--tg-muted)]">{shownOf(limit, games.length)}</span>
          <button type="button" className="tg-btn min-h-[40px] px-4 text-[13px] [@media(pointer:coarse)]:min-h-[44px]" onClick={() => setLimit(l => l + PAGE)}>
            Show more
          </button>
        </div>
      )}
    </>
  )
}

function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-black/40 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex justify-end">
        <DialogPanel
          transition
          className="flex h-full w-full max-w-[30rem] flex-col border-l border-[var(--tg-border-strong)] bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-300 ease-out data-[closed]:translate-x-full"
        >
          <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[var(--tg-border)] px-5">
            <DialogTitle className="text-[17px] font-bold">{title}</DialogTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[var(--tg-muted)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]">
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="tg-scroll-y min-h-0 flex-1 px-5 pb-6 pt-4">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

export function TgAnalyticsDrill({ kind, scoped, start, end, library, onClose }: {
  kind: TgaTile | null; scoped: TgGame[]; start: number | null; end: number; library: TgaLibrary; onClose: () => void
}) {
  const bp = useTgBreakpoint()
  // Kept while the sheet animates out, so it doesn't empty mid-transition.
  const [last, setLast] = useState<TgaTile>('games')
  if (kind && kind !== last) setLast(kind)
  const shownKind = kind ?? last
  const games = useMemo(() => tileGames(shownKind, scoped, start, end), [shownKind, scoped, start, end])
  const windowed = start != null
  const libLabel = TGA_LIBRARIES.find(l => l.key === library)?.label ?? 'All'
  const scope = `${windowed ? `Since ${formatDay(new Date(start).toISOString())}` : 'All time'} · ${library === 'all' ? 'all libraries' : libLabel}`

  const onPick = (id: string) => {
    onClose()
    if (bp !== 'mobile') { openGameFromAnalytics(id); return }
    // The phone sheet closes by popping its history entry; open the game's
    // sheet only once that Back has landed, or its own entry would be the one popped.
    let done = false
    const go = () => { if (!done) { done = true; openGameFromAnalytics(id) } }
    window.addEventListener('popstate', go, { once: true })
    window.setTimeout(go, 350)
  }

  const title = drillTitle(shownKind, windowed)
  const body = <Body key={shownKind} kind={shownKind} games={games} windowed={windowed} scope={scope} onPick={onPick} />
  return bp === 'mobile'
    ? <TgMobileSheet open={kind != null} onClose={onClose} title={title}>{body}</TgMobileSheet>
    : <Drawer open={kind != null} onClose={onClose} title={title}>{body}</Drawer>
}
