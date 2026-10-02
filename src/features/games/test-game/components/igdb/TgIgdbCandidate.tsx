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

export interface IgdbOurs { title: string; platform: string; year: number | null }

const MARK = { good: '✓', close: '≈', bad: '✗', unknown: '?' } as const
type MarkKind = keyof typeof MARK
const MARK_CLS: Record<MarkKind, string> = {
  good: 'text-[var(--tg-green)]', close: 'text-[var(--tg-text)]', bad: 'text-[var(--tg-red)]', unknown: 'tg-muted',
}

/** What agreed and what didn't: title, platform and year, yours beside IGDB's. */
function Comparison({ c, ours }: { c: ScoredCandidate; ours: IgdbOurs }) {
  const titleKind: MarkKind = c.titleMatch === 'same' ? 'good' : c.titleMatch === 'weak' ? 'bad' : 'close'
  const titleNote = c.titleMatch === 'same' ? 'same title' : c.titleMatch === 'subtitle' ? 'same game name, subtitle differs' : c.titleMatch === 'close' ? `similar (${Math.round(c.titleScore * 100)} %)` : `different (${Math.round(c.titleScore * 100)} %)`
  const viaAlt = c.matchedName && c.matchedName !== c.name ? ` · matched IGDB's other name “${c.matchedName}”` : ''
  const platKind: MarkKind = c.platformMatch === true ? 'good' : c.platformMatch === false ? 'bad' : 'unknown'
  const platNote = c.platformMatch === true ? `on ${ours.platform}` : c.platformMatch === false ? `IGDB lists ${c.platformNames.slice(0, 3).join(', ') || 'other platforms'}` : 'IGDB lists no platform we can compare'
  const yearKind: MarkKind = c.yearMatch === true ? (c.yearDiff === 0 ? 'good' : 'close') : c.yearMatch === false ? 'bad' : 'unknown'
  const yearNote = c.year && ours.year ? (c.yearDiff === 0 ? `${c.year}` : `${c.year} vs your ${ours.year}`) : c.year ? `${c.year} (you have no year)` : 'IGDB has no date'
  const rows: [string, MarkKind, string][] = [
    ['Title', titleKind, titleNote + viaAlt],
    ['Platform', platKind, platNote],
    ['Year', yearKind, yearNote],
  ]
  return (
    <span className="mt-1 grid grid-cols-[4.2rem_1rem_minmax(0,1fr)] gap-x-1 text-[11.5px] leading-snug">
      {rows.map(([label, kind, note]) => (
        <span key={label} className="contents">
          <span className="tg-muted">{label}</span>
          <span aria-hidden className={`font-bold ${MARK_CLS[kind]}`}>{MARK[kind]}</span>
          <span className="min-w-0"><span className="sr-only">{kind === 'good' ? 'matches' : kind === 'close' ? 'close' : kind === 'bad' ? 'does not match' : 'unknown'}: </span>{note}</span>
        </span>
      ))}
    </span>
  )
}

/** One IGDB result: cover, name, year, platform agreement and how sure the match is. */
export function TgIgdbCandidate({ c, ours }: { c: ScoredCandidate; ours?: IgdbOurs }) {
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
        {ours && <Comparison c={c} ours={ours} />}
      </span>
    </span>
  )
}
