import { ChevronRight, CircleAlert, CircleCheck, RadioTower, TriangleAlert } from 'lucide-react'
import { formatDay } from '../testGameModel'
import type { TgaFreshness } from './tgAnalyticsHealth'
import { plural } from './tgAnalyticsFormat'
import { SOURCE_META, sourceFix, sourceTone, syncAgo, type TgaSourceTone } from './tgAnalyticsHealthCopy'
import { useToday } from './tgAnalyticsClock'
import { openLibrary } from './tgAnalyticsNav'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

// Amber and red tint a stale source; the icon and the words say the same, so
// the colour never works alone.
const TONE: Record<TgaSourceTone, { row: string; text: string; icon: typeof CircleCheck; iconColor: string }> = {
  ok: { row: 'bg-[var(--tg-panel-2)]', text: 'text-[var(--tg-text-2)]', icon: CircleCheck, iconColor: 'text-[var(--tg-green)]' },
  warn: {
    row: 'bg-[color-mix(in_srgb,var(--tg-star)_10%,transparent)]',
    text: 'text-[color-mix(in_srgb,var(--tg-star)_70%,var(--tg-text))]',
    icon: TriangleAlert,
    iconColor: 'text-[color-mix(in_srgb,var(--tg-star)_80%,var(--tg-text))]',
  },
  bad: { row: 'bg-[color-mix(in_srgb,var(--tg-red)_9%,transparent)]', text: 'text-[var(--tg-red)]', icon: CircleAlert, iconColor: 'text-[var(--tg-red)]' },
}

function Row({ row, today }: { row: TgaFreshness; today: number }) {
  const meta = SOURCE_META[row.library]
  const tone = TONE[sourceTone(row)]
  const Icon = tone.icon
  const fix = row.stale ? sourceFix(row.library) : null
  const date = row.lastSync ? formatDay(row.lastSync) : null

  return (
    <li className={`rounded-[12px] px-3 py-2.5 ${tone.row}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--tg-text)]">{meta.name}</span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-[var(--tg-muted)]" title="Every title from this source, hidden ones included">
          {plural(row.games, 'title')}
        </span>
      </div>
      <p className={`mt-1 flex items-center gap-1.5 pl-5 text-[12.5px] ${tone.text}`} title={date ? `Last sync ${date}` : undefined}>
        <Icon size={13} strokeWidth={2.2} aria-hidden className={`shrink-0 ${tone.iconColor}`} />
        <span className="min-w-0">
          {syncAgo(row.lastSync, today)}
          {date && <span className="sr-only"> ({date})</span>}
          {row.stale && <span className="sr-only">, out of date</span>}
        </span>
      </p>
      {fix?.kind === 'hint' && <p className="mt-1 pl-5 text-[12px] leading-relaxed text-[var(--tg-muted)]">{fix.text}</p>}
      {fix?.kind === 'shelf' && (
        <button
          type="button"
          onClick={() => openLibrary({ platform: row.library })}
          aria-label={fix.name}
          className="tg-btn tg-btn-secondary ml-5 mt-2 min-h-[34px] gap-1.5 px-3 text-[12.5px] [@media(pointer:coarse)]:min-h-[44px]"
        >
          {fix.label}
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
        </button>
      )}
    </li>
  )
}

/**
 * When each library last heard from its source: the handheld's ES-DE push,
 * a Steam or a PlayStation sync. Past a week a source is flagged, with how
 * to bring it up to date.
 */
export function TgAnalyticsFreshness({ rows, className = '' }: { rows: TgaFreshness[]; className?: string }) {
  const today = useToday()
  const stale = rows.filter(r => r.stale).length
  return (
    <TgAnalyticsCard label="Sources" meta={rows.length ? (stale ? `${stale} out of date` : 'all up to date') : undefined} className={className}>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map(r => <Row key={r.library} row={r} today={today} />)}
        </ul>
      ) : (
        <TgAnalyticsEmpty icon={RadioTower} title="No sources yet" hint="ES-DE, Steam and PlayStation show up here after their first sync." />
      )}
    </TgAnalyticsCard>
  )
}
