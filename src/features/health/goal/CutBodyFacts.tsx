import type { ReactNode } from 'react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { TonePill } from '../../../shared/ui'
import { fmtDayMonth } from '../components/healthFormat'
import type { CutReport } from './energyBalance'
import { PROTEIN_COPY, RATE_COPY, signed } from './cutCopy'

function Row({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="section-label flex items-center gap-1">{label}{info && <InfoBubble>{info}</InfoBubble>}</p>
      <div className="text-body text-fg-2">{children}</div>
    </div>
  )
}

/** Rate vs Garthe, protein vs Morton/Helms, fat vs lean from the scale,
 *  and the projected goal date. */
export function CutBodyFacts({ r, targetProtein }: { r: CutReport; targetProtein: number }) {
  const w = r.weight
  const rate = r.rate ? RATE_COPY[r.rate] : null
  const prot = r.protein.band ? PROTEIN_COPY[r.protein.band] : null
  const comp = r.composition
  return (
    <div className="flex flex-col gap-3">
      <Row label="Rate of loss" info={<>Garthe et al., Int J Sport Nutr Exerc Metab 2011: athletes losing ~0.7 % of bodyweight a week gained 2.1 % lean mass while cutting; at ~1.4 % a week lean mass stayed flat. The authors suggest 0.7 %/wk to build lean mass and up to 1.0–1.4 %/wk to keep it.</>}>
        {w.kgPerWeek == null || !rate ? <p className="text-fg-muted">Needs 4+ weigh-ins over a week.</p> : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <strong className="tabular-nums text-fg">{signed(w.kgPerWeek, 2, ' kg')}/week</strong>
              <span className="tabular-nums text-fg-muted">({w.pctPerWeek != null ? signed(-w.pctPerWeek, 2, ' %') : '—'} of bodyweight)</span>
              <TonePill tone={rate.tone}>{rate.label}</TonePill>
            </p>
            <p className="text-meta text-fg-muted">{rate.note}</p>
          </>
        )}
      </Row>

      <Row label="Protein" info={<>Morton et al., Br J Sports Med 2018: no further lean-mass gain above ~1.6 g per kg bodyweight a day (range of the estimate up to ~2.2) — treat 1.6 as a floor. Helms et al. 2014: lean lifters in a deficit likely need 2.3–3.1 g per kg of fat-free mass.</>}>
        {r.protein.gPerKg == null || !prot ? <p className="text-fg-muted">Needs logged days and a weight.</p> : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <strong className="tabular-nums text-fg">{r.protein.gPerKg.toFixed(1)} g/kg</strong>
              <span className="tabular-nums text-fg-muted">({r.intake.meanProteinG} g/day · target {targetProtein} g)</span>
              <TonePill tone={prot.tone}>{prot.label}</TonePill>
            </p>
            {r.protein.gPerKgFfm != null && (
              <p className="text-meta text-fg-muted">
                {r.protein.gPerKgFfm.toFixed(1)} g per kg of lean mass (scale) — the cut range for lean lifters is 2.3–3.1.
              </p>
            )}
          </>
        )}
      </Row>

      <Row label="Fat vs lean (smart scale)" info="From the first and last smart-scale report in the window. The scale estimates lean mass from electrical impedance, which moves with hydration and glycogen, so small lean changes (under ~1 kg) are within its noise.">
        {!comp ? <p className="text-fg-muted">Needs two scale reports at least a week apart in this window.</p> : (
          <>
            <p className="tabular-nums">
              Fat <strong className="text-fg">{comp.fatChangeKg != null ? signed(comp.fatChangeKg, 1, ' kg') : '—'}</strong>
              {' · '}Lean <strong className="text-fg">{comp.leanChangeKg != null ? signed(comp.leanChangeKg, 1, ' kg') : '—'}</strong>
            </p>
            <p className="text-meta text-fg-muted">
              {fmtDayMonth(comp.from)} → {fmtDayMonth(comp.to)}
              {comp.leanShareOfLoss != null && ` · ${Math.round(comp.leanShareOfLoss * 100)} % of the weight lost was lean mass`}
            </p>
          </>
        )}
      </Row>

      <Row label="Goal date">
        {r.projection == null ? <p className="text-fg-muted">Set a goal weight below to see a projected date.</p>
          : r.projection === 'reached' ? <p>Your trend weight is already at or under your goal.</p>
          : r.projection === 'not_losing' ? <p className="text-fg-muted">The trend isn't going down, so there's no date to project.</p>
          : r.projection === 'too_far' ? <p className="text-fg-muted">More than two years away at the current rate.</p>
          : (
            <p>
              <strong className="text-fg">{fmtDayMonth(r.projection.date)}</strong>
              <span className="text-fg-muted"> for {r.projection.goalKg} kg — {r.projection.days} days at the current trend, if nothing changes.</span>
            </p>
          )}
      </Row>
    </div>
  )
}
