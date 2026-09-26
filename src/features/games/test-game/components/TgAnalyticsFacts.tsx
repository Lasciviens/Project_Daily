import type { LucideIcon } from 'lucide-react'
import { CalendarClock, ChevronRight, Monitor, Rocket, Sparkles, Tags, Timer } from 'lucide-react'
import type { TgaFact } from './tgAnalyticsMore'
import { TgAnalyticsCard } from './TgAnalyticsCard'
import { openGameFromAnalytics } from './tgAnalyticsOpen'

const ICONS: Record<string, LucideIcon> = { oldest: CalendarClock, launched: Rocket, session: Timer, platform: Monitor, genre: Tags }

// As many columns as the card has room for: one in a narrow card, three in a
// double-width one, a single row of five across the full width.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2'
const CHIP = 'flex w-full min-w-0 items-center gap-3 rounded-[12px] border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-3 py-2 text-left [@media(pointer:coarse)]:min-h-[44px]'

function Body({ fact }: { fact: TgaFact }) {
  const Icon = ICONS[fact.key] ?? Sparkles
  return (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
        <Icon size={14} strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-[var(--tg-muted)]">{fact.label}</span>
        <span className="mt-0.5 block truncate text-[13px] font-semibold text-[var(--tg-text)]" title={fact.value}>{fact.value}</span>
      </span>
    </>
  )
}

/** A handful of small facts from what's filled in; one about a game opens it. */
export function TgAnalyticsFacts({ facts, className = '' }: { facts: TgaFact[]; className?: string }) {
  if (!facts.length) return null
  return (
    <TgAnalyticsCard label="Fun facts" className={className}>
      <ul className={GRID}>
        {facts.map(fact => (
          <li key={fact.key} className="min-w-0">
            {fact.game ? (
              <button
                type="button"
                onClick={() => { if (fact.game) openGameFromAnalytics(fact.game.id) }}
                aria-label={`${fact.label}: ${fact.value}. Open details`}
                className={`${CHIP} transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]`}
              >
                <Body fact={fact} />
                <ChevronRight size={14} strokeWidth={2.2} aria-hidden className="shrink-0 text-[var(--tg-faint)]" />
              </button>
            ) : (
              <div className={CHIP}><Body fact={fact} /></div>
            )}
          </li>
        ))}
      </ul>
    </TgAnalyticsCard>
  )
}
