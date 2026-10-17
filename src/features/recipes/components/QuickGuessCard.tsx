import { useState, type ReactNode } from 'react'
import { SlidersHorizontal, Sparkles, Zap } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, Skeleton, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useLogGuess, useQuickGuessPresets, useRecentGuesses } from '../hooks/useQuickGuess'
import { factorLabel, GUESS_FACTORS, guessTitle, scaleGuess, type GuessMacros, type GuessPreset } from '../quickGuess'
import { foodEmoji, slotForNow, SLOT_OPTIONS } from './foodLogUtils'
import { GuessAskPopover, GuessAskSheet, type AskedGuess } from './QuickGuessAsk'
import { DescribeGuessSheet } from './DescribeGuessSheet'

type FactorValue = `${typeof GUESS_FACTORS[number]}`
const FACTORS = GUESS_FACTORS.map(f => ({ value: String(f) as FactorValue, label: <span title={`${factorLabel(f)} portion`}>{factorLabel(f)}</span> }))

const macroText = (m: GuessMacros) => [`${m.protein} g protein`, `${m.carbs} g carbs`, `${m.fat} g fat`].join(' · ')

const CHIP_CLASS = 'press-feedback flex min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1 text-left transition-colors hover:border-accent-500/40 hover:bg-surface-hover'

/** A chip's face: icon, title, the small line under it, and a mark when it asks first. */
function ChipFace({ icon, title, sub, asks }: { icon: ReactNode; title: string; sub: string; asks?: boolean }) {
  return (
    <>
      <span aria-hidden className="text-base leading-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-accent-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <Truncate className="text-body font-medium text-fg">{title}</Truncate>
        <Truncate className="text-micro tabular-nums text-fg-muted">{sub}</Truncate>
      </span>
      {asks && <SlidersHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
    </>
  )
}

function GuessChip({ hint, onClick, opens, ...face }: { icon: ReactNode; title: string; sub: string; asks?: boolean; opens?: boolean; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={hint} aria-haspopup={face.asks || opens ? 'dialog' : undefined} className={CHIP_CLASS}>
      <ChipFace {...face} />
    </button>
  )
}

/**
 * "Quick guess": log something you can't weigh — sweets, a soft drink, a
 * beer — as a one-off diary line with typical macros, in one tap. The size
 * switch scales every macro (½ to 2 portions) and goes back to 1 after a log;
 * your own recent one-off lines sit under the presets. The presets are the
 * owner's own (Settings → Food → Quick guess, migration 152). A preset with
 * options (migration 159) asks first — a bottom sheet on a phone, a popover
 * under the chip elsewhere; "Describe it" lets the AI estimate what you type,
 * for you to check before it logs. Logs to the meal slot for now (snack on
 * another day), like "What's left".
 */
export function QuickGuessCard({ date }: { date: string }) {
  const modal = useEntityModal()
  const phone = useBreakpoint() === 'phone'
  const { presets, isLoading, isError, refetch } = useQuickGuessPresets()
  const recents = useRecentGuesses(presets)
  const log = useLogGuess()
  const [factor, setFactor] = useState<FactorValue>('1')
  const [asking, setAsking] = useState<GuessPreset | null>(null)
  const [describing, setDescribing] = useState<string | null>(null)
  const f = Number(factor)
  const slot = date === todayStr() ? slotForNow() : 'snack'
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot

  function logLine(g: AskedGuess) {
    log.mutate({ date, slot, ...g })
    setFactor('1')
  }
  const logGuess = (title: string, base: GuessMacros) => logLine({ title: guessTitle(title, f), ...scaleGuess(base, f) })
  const sub = (m: GuessMacros) => `${m.kcal} kcal${m.protein >= 5 ? ` · ${m.protein} g protein` : ''}`
  const ask = { factor: f, slotName, onLog: logLine, onDescribe: (text: string) => setDescribing(text) }

  return (
    <Card>
      <CardHeader title="Quick guess" variant="label" icon={<Zap />} subtitle={`Logs to ${slotName}`}
        action={<SegmentedControl size="sm" options={FACTORS} value={factor} onChange={setFactor} />} />
      {isError && (
        <p className="mb-1.5 text-meta text-fg-muted">
          Your presets didn't load. <button type="button" onClick={refetch} className="font-semibold text-accent-600">Try again</button>
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5">
        {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[42px]" />)}
        {presets.map(p => {
          const m = scaleGuess(p, f)
          const one = [f === 1 ? '' : `${factorLabel(f)} ×`, p.portion].filter(Boolean).join(' ')
          const icon = p.icon || foodEmoji(p.title)
          if (p.options?.length) {
            const hint = `${p.title}${one ? `, ${one}` : ''}: from ${m.kcal} kcal — asks ${p.options.map(g => g.name.toLowerCase()).join(', ')} first`
            const face = <ChipFace icon={icon} title={guessTitle(p.title, f)} sub={sub(m)} asks />
            return phone
              ? <GuessChip key={p.key} icon={icon} title={guessTitle(p.title, f)} sub={sub(m)} asks hint={hint} onClick={() => setAsking(p)} />
              : <GuessAskPopover key={p.key} preset={p} {...ask} buttonClassName={CHIP_CLASS} buttonTitle={hint}>{face}</GuessAskPopover>
          }
          return (
            <GuessChip key={p.key} icon={icon} title={guessTitle(p.title, f)} sub={sub(m)}
              hint={`${p.title}${one ? `, ${one}` : ''}: ${m.kcal} kcal · ${macroText(m)}`}
              onClick={() => logGuess(p.title, p)} />
          )
        })}
        <GuessChip icon="✏️" title="Your own" sub="kcal and macros"
          hint="Open the logger and type it, e.g. “kebab 700 kcal”"
          onClick={() => modal.open({ kind: 'food-log', date, slot })} />
        <GuessChip icon={<Sparkles />} title="Describe it" sub="AI estimate" opens
          hint="Type what you had: the AI estimates it and you check the numbers before logging"
          onClick={() => setDescribing('')} />
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
      {asking && <GuessAskSheet preset={asking} {...ask} onClose={() => setAsking(null)} />}
      {describing != null && <DescribeGuessSheet initialText={describing} date={date} slot={slot} onClose={() => setDescribing(null)} />}
    </Card>
  )
}
