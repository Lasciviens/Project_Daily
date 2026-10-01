import type { ReactNode } from 'react'
import { igdbImage, type ScoredCandidate } from '../../../igdb/igdbMatch'
import { Truncate } from '../../../../../shared/ui/Truncate'

const CONFIDENCE: Record<ScoredCandidate['confidence'], { label: string; cls: string; title: string }> = {
  exact: { label: 'Exact', cls: 'bg-[color-mix(in_srgb,var(--tg-green)_16%,transparent)] text-[var(--tg-green)]', title: 'Same title on the same platform or year, and no other game like it' },
  likely: { label: 'Likely', cls: 'bg-[var(--tg-panel-2)] text-[var(--tg-text)] border border-[var(--tg-border)]', title: 'Close — check it before saving' },
  unsure: { label: 'Unsure', cls: 'bg-[color-mix(in_srgb,var(--tg-red)_12%,transparent)] text-[var(--tg-red)]', title: 'The title or platform differs — probably another game' },
}

function Chip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad'; title?: string }) {
  const cls = tone === 'good' ? 'text-[var(--tg-green)] border-[color-mix(in_srgb,var(--tg-green)_40%,transparent)]'
    : tone === 'bad' ? 'text-[var(--tg-red)] border-[color-mix(in_srgb,var(--tg-red)_40%,transparent)]'
    : 'text-[var(--tg-text-2)] border-[var(--tg-border)]'
  return <span title={title} className={`inline-flex h-[22px] items-center rounded-md border bg-[var(--tg-panel)] px-1.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

/** One IGDB result: cover, name, year, platform agreement and how sure the match is. */
export function TgIgdbCandidate({ c }: { c: ScoredCandidate }) {
  const conf = CONFIDENCE[c.confidence]
  const cover = igdbImage(c.coverId, 'thumb')
  const platformText = c.platformNames.slice(0, 2).join(', ') + (c.platformNames.length > 2 ? ` +${c.platformNames.length - 2}` : '')
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 h-[34px] w-[25px] shrink-0 overflow-hidden rounded bg-[var(--tg-panel-2)]">
        {cover && <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0">
        <Truncate lines={2} className="text-[12.5px] leading-snug">{c.name}</Truncate>
        <span className="mt-0.5 flex flex-wrap gap-1">
          <span title={conf.title} className={`inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-semibold ${conf.cls}`}>{conf.label}</span>
          {c.year ? <Chip tone={c.yearMatch === true ? 'good' : c.yearMatch === false ? 'bad' : 'neutral'}>{String(c.year)}</Chip> : null}
          {platformText && <Chip tone={c.platformMatch === true ? 'good' : c.platformMatch === false ? 'bad' : 'neutral'} title={c.platformNames.join(', ')}>{platformText}</Chip>}
          {c.type && !/main/i.test(c.type) && <Chip>{c.type}</Chip>}
        </span>
      </span>
    </span>
  )
}
