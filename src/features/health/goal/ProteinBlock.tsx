import { TonePill } from '../../../shared/ui'
import type { EnergyReport, Phase } from './energyBalance'
import { PROTEIN_COPY } from './goalCopy'
import { GoalBlock, Cites } from './GoalBlock'

/** Protein per kg of bodyweight (Morton 2018) and per kg of lean mass on a cut (Helms 2014). */
export function ProteinBlock({ r, phase, targetProtein, card }: { r: EnergyReport; phase: Phase; targetProtein: number; card?: boolean }) {
  const band = r.protein.band ? PROTEIN_COPY[r.protein.band] : null
  return (
    <GoalBlock title="Protein" card={card} info={<>
      No further lean-mass gain above ~1.6 g per kg of bodyweight a day, with the estimate reaching ~2.2 — treat 1.6 as a floor (Morton 2018). Lean lifters in a deficit likely need 2.3–3.1 g per kg of fat-free mass (Helms 2014). Averaged over the days you logged.
      <Cites keys={['morton2018', 'helms2014protein']} />
    </>}>
      {r.protein.gPerKg == null || !band ? <p className="text-body text-fg-muted">Needs logged days and a weight.</p> : (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-lead tabular-nums text-fg">{r.protein.gPerKg.toFixed(1)} g/kg</strong>
            <span className="text-meta tabular-nums text-fg-muted">({r.intake.meanProteinG} g a day · target {targetProtein} g)</span>
            <TonePill tone={band.tone}>{band.label}</TonePill>
          </p>
          {r.protein.gPerKgFfm != null && (
            <p className="text-meta text-fg-muted">
              {r.protein.gPerKgFfm.toFixed(1)} g per kg of lean mass (scale){phase === 'cut' ? ' — the range for lean lifters in a deficit is 2.3–3.1.' : '.'}
            </p>
          )}
        </>
      )}
    </GoalBlock>
  )
}
