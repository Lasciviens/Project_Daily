import { ChevronRight, Eye } from 'lucide-react'
import { fmtInt, plural } from './tgAnalyticsFormat'
import { HIDDEN_AUTO_NOTE, HIDDEN_EMPTY_HINT } from './tgAnalyticsHealthCopy'
import { useAnalyticsHandoff } from './tgAnalyticsHandoff'
import { hiddenGames } from './tgAnalyticsLists'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-[var(--tg-panel-2)] px-3 py-2.5">
      <dt className="truncate text-[12px] font-medium text-[var(--tg-text-2)]">{label}</dt>
      <dd className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums text-[var(--tg-text)]">{fmtInt(value)}</dd>
      <dd className="mt-1 truncate text-[11.5px] text-[var(--tg-muted)]">{sub}</dd>
    </div>
  )
}

/**
 * What is left out of every figure: titles you hid, and the apps and
 * non-games hidden until someone gives them a status. The button shows them
 * in the Library, where each one can be unhidden.
 */
export function TgAnalyticsHiddenTitles({ hidden, className = '' }: {
  hidden: { total: number; explicit: number; auto: number }
  className?: string
}) {
  const handoff = useAnalyticsHandoff()
  if (hidden.total === 0) {
    return (
      <TgAnalyticsCard label="Hidden titles" className={className}>
        <TgAnalyticsEmpty icon={Eye} title="Nothing hidden" hint={HIDDEN_EMPTY_HINT} />
      </TgAnalyticsCard>
    )
  }
  return (
    <TgAnalyticsCard label="Hidden titles" meta={plural(hidden.total, 'title')} className={className}>
      {/* Side by side once the card is wide (it spans two columns on a monitor), so the tiles don't stretch. */}
      <div className="flex flex-1 flex-col @[40rem]:grid @[40rem]:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] @[40rem]:gap-x-6">
        <dl className="grid grid-cols-2 gap-2 @[40rem]:self-start">
          <Tile label="Hidden by you" value={hidden.explicit} sub="with Hide game" />
          <Tile label="Hidden automatically" value={hidden.auto} sub="apps and non-games" />
        </dl>
        <div className="flex flex-1 flex-col">
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--tg-muted)] @[40rem]:mt-0">
            Hidden titles are left out of the counts, charts and play time in Analytics.{hidden.auto > 0 && ` ${HIDDEN_AUTO_NOTE}`}
          </p>
          <div className="mt-auto pt-4">
            <button
              type="button"
              onClick={() => { const b = handoff.base; if (b) handoff.open('Hidden', hiddenGames(b.games, b.library), { status: 'hidden', wholeLibrary: true }) }}
              className="tg-btn tg-btn-secondary min-h-[36px] w-full px-3 text-[13px] @[22rem]:w-auto [@media(pointer:coarse)]:min-h-[44px]"
            >
              Show hidden titles
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </TgAnalyticsCard>
  )
}
