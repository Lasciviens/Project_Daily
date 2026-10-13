import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useLogGuess, useRecentGuesses } from '../hooks/useQuickGuess'
import { factorLabel, GUESS_FACTORS, GUESS_PRESETS, guessTitle, scaleGuess, type GuessMacros } from '../quickGuess'
import { foodEmoji, slotForNow, SLOT_OPTIONS } from './foodLogUtils'

type FactorValue = `${typeof GUESS_FACTORS[number]}`
const FACTORS = GUESS_FACTORS.map(f => ({ value: String(f) as FactorValue, label: <span title={`${factorLabel(f)} portion`}>{factorLabel(f)}</span> }))

const macroText = (m: GuessMacros) => [`${m.protein} g protein`, `${m.carbs} g carbs`, `${m.fat} g fat`].join(' · ')

function GuessChip({ icon, title, sub, hint, onClick }: { icon: string; title: string; sub: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={hint}
      className="press-feedback flex min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1 text-left transition-colors hover:border-accent-500/40 hover:bg-surface-hover">
      <span aria-hidden className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1">
        <Truncate className="text-body font-medium text-fg">{title}</Truncate>
        <Truncate className="text-micro tabular-nums text-fg-muted">{sub}</Truncate>
      </span>
    </button>
  )
}

/**
 * "Quick guess": log something you can't weigh — sweets, a soft drink, a
 * beer — as a one-off diary line with typical macros, in one tap. The size
 * switch scales every macro (½ to 2 portions) and goes back to 1 after a log;
 * your own recent one-off lines sit under the presets. Logs to the meal slot
 * for now (snack on another day), like "Fits what's left".
 */
export function QuickGuessCard({ date }: { date: string }) {
  const modal = useEntityModal()
  const recents = useRecentGuesses()
  const log = useLogGuess()
  const [factor, setFactor] = useState<FactorValue>('1')
  const f = Number(factor)
  const slot = date === todayStr() ? slotForNow() : 'snack'
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot

  function logGuess(title: string, base: GuessMacros) {
    log.mutate({ date, slot, title: guessTitle(title, f), ...scaleGuess(base, f) })
    setFactor('1')
  }
  const sub = (m: GuessMacros) => `${m.kcal} kcal${m.protein >= 5 ? ` · ${m.protein} g protein` : ''}`

  return (
    <Card>
      <CardHeader title="Quick guess" variant="label" icon={<Zap />} subtitle={`Logs to ${slotName}`}
        action={<SegmentedControl size="sm" options={FACTORS} value={factor} onChange={setFactor} />} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5">
        {GUESS_PRESETS.map(p => {
          const m = scaleGuess(p, f)
          return (
            <GuessChip key={p.key} icon={p.icon} title={guessTitle(p.title, f)} sub={sub(m)}
              hint={`${p.title}, ${f === 1 ? '' : `${factorLabel(f)} × `}${p.portion}: ${m.kcal} kcal · ${macroText(m)}`}
              onClick={() => logGuess(p.title, p)} />
          )
        })}
        <GuessChip icon="✏️" title="Your own" sub="kcal and macros"
          hint="Open the logger and type it, e.g. “kebab 700 kcal”"
          onClick={() => modal.open({ kind: 'food-log', date, slot })} />
      </div>
      {recents.length > 0 && (
        <>
          <p className="section-label mb-1.5 mt-3">Your recent guesses</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5">
            {recents.map(r => {
              const m = scaleGuess(r, f)
              return (
                <GuessChip key={r.key} icon={foodEmoji(r.title)} title={guessTitle(r.title, f)} sub={sub(m)}
                  hint={`${guessTitle(r.title, f)}: ${m.kcal} kcal · ${macroText(m)} — logged ${r.count}× in 30 days`}
                  onClick={() => logGuess(r.title, r)} />
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
