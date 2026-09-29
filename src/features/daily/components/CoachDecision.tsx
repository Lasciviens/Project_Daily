import { Check } from 'lucide-react'
import { ToneDot } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Cites } from '../../health/goal/GoalBlock'
import type { NutritionCoach } from '../hooks/useNutritionCoach'
import { Suggestion } from './goalEditorParts'

/** THE coach's answer (cutDecision.ts) — the same headline, lines and
 *  suggestions in the goal editor and on Food · Today. "Apply" hands the new
 *  number to the caller (a draft in the editor, a write on Food). */
export function CoachDecisionView({ coach, currentProtein, onApplyCalories, onApplyProtein }: {
  coach: NutritionCoach
  currentProtein: number
  onApplyCalories: (kcal: number) => void
  onApplyProtein: (g: number) => void
}) {
  if (coach.weightKg == null) {
    return coach.isLoading
      ? <p className="text-meta text-fg-muted">Reading your weight, diary and energy…</p>
      : <p className="text-meta text-fg-muted">Weigh in on your scale (or log a weight in Health → Body) to get protein and calorie coaching from your real weight trend.</p>
  }
  const d = coach.decision
  const p = d.protein
  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite">
        <p className="flex items-start gap-2 text-body font-medium text-fg">
          <ToneDot tone={d.tone} className="mt-1.5 shrink-0" />
          <span>{d.headline}</span>
        </p>
        {d.lines.map(l => <p key={l} className="mt-0.5 pl-4 text-meta text-fg-2">{l}</p>)}
      </div>
      {d.suggestedCalories != null && d.calorieDelta != null && d.calorieDelta !== 0 && (
        <Suggestion onApply={() => onApplyCalories(d.suggestedCalories!)}>
          Set calories to <strong className="tabular-nums text-accent-700">{d.suggestedCalories.toLocaleString('en-GB')} kcal</strong>
          <span className="text-fg-muted"> ({d.calorieDelta > 0 ? '+' : '−'}{Math.abs(d.calorieDelta)} kcal/day)</span>
        </Suggestion>
      )}

      {p && (p.inRange || currentProtein === p.targetG ? (
        <p data-tone="success" className="tone-text flex items-center gap-1.5 text-meta">
          <Check aria-hidden className="h-4 w-4 shrink-0" />Protein {currentProtein} g is in your range ({p.lowG}–{p.highG} g).
        </p>
      ) : (
        <Suggestion onApply={() => onApplyProtein(p.targetG)}>{p.text}</Suggestion>
      ))}
      {p && (
        <p className="flex items-center gap-1.5 text-meta text-fg-muted">
          <span>
            {p.basis === 'ffm' ? `${(p.targetG / p.ffmKg!).toFixed(1)} g per kg of lean mass (${p.ffmKg} kg)` : `${p.gPerKg} g per kg of bodyweight`}
            {' · '}~{p.perMealG} g per meal spreads it best
          </span>
          <InfoBubble label="Where the protein and floor numbers come from">
            Protein: no further muscle gain above ~1.6 g per kg of bodyweight on average, the estimate reaching ~2.2 (Morton 2018); lean lifters in a deficit likely need 2.3–3.1 g per kg of lean mass (Helms 2014); spread it over 3–4 meals of ~0.25–0.4 g/kg (Jäger 2017). Calorie floor: the highest of 1,500 kcal, a resting-burn estimate (500 + 22 × lean mass, Cunningham 1980) and 75 % of what the scale says you burn — a heuristic, not a hard limit.
            <Cites keys={['morton2018', 'helms2014protein', 'jager2017', 'cunningham1980']} />
          </InfoBubble>
        </p>
      )}
      {d.notes.map(n => <p key={n} className="text-meta text-fg-muted">{n}</p>)}
    </div>
  )
}
