import { ToneDot, cx, type Tone } from '../../../../shared/ui'
import type { Aim, AimStatus } from '../../benchmarks/healthBenchmarks'

// The "Aim: …" line (benchmarks/aimGuidance.ts): one tone for what it asks —
// keep it (success), a step worth taking (info) or a short-term signal (warn).
// Spans only, so it can sit inside a tile's <button>.

const TONE: Record<AimStatus, Tone> = { keep: 'success', improve: 'info', watch: 'warn' }
const STATUS_WORD: Record<AimStatus, string> = { keep: 'On target', improve: 'Next step', watch: 'Watch' }

/** `full` adds the aim's sheet-only sentences (`more`). */
export function AimLine({ aim, full, className }: { aim: Aim; full?: boolean; className?: string }) {
  return (
    <span className={cx('flex gap-1.5 text-meta leading-snug text-fg-2', className)}>
      <ToneDot tone={aim.status ? TONE[aim.status] : 'neutral'} className="mt-[0.4em] shrink-0" />
      <span className="min-w-0">
        {aim.status && <span className="sr-only">{STATUS_WORD[aim.status]}. </span>}
        <b className="font-semibold text-fg">Aim:</b> {aim.text}{full && aim.more ? ` ${aim.more}` : ''}
      </span>
    </span>
  )
}
