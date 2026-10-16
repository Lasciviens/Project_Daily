import { useState } from 'react'
import { ChevronDown, Plus, Sparkles, X } from 'lucide-react'
import { Button, IconButton, TonePill, Truncate, cx } from '../../../shared/ui'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { useSuggestGuessOptions } from '../hooks/useQuickGuess'
import {
  EMPTY_CHOICE, factorText, groupToDraft, OPTION_LIMITS,
  type ChoiceDraft, type GroupDraft, type GuessDraft, type GuessPick,
} from '../quickGuess'
import { DecimalInput } from './foodLogKit'

const PICKS: { value: GuessPick; label: string }[] = [
  { value: 'one', label: 'Pick one (adds)' },
  { value: 'any', label: 'Pick any (add)' },
  { value: 'size', label: 'Size (multiplies)' },
]
const MACROS = [
  { key: 'kcal', label: 'Kcal' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'sugar', label: 'Sugar' },
] as const

function choiceSummary(c: ChoiceDraft, pick: GuessPick): string {
  if (pick === 'size') return c.factor != null && c.factor > 0 ? factorText(c.factor) : 'no size yet'
  const parts = [c.kcal ? `+${c.kcal} kcal` : '', c.protein ? `${c.protein} g protein` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'adds nothing'
}

/** One choice: a summary row that opens its fields in place. */
function ChoiceRow({ choice, pick, open, onToggle, onChange, onRemove }: {
  choice: ChoiceDraft; pick: GuessPick; open: boolean
  onToggle: () => void; onChange: (c: ChoiceDraft) => void; onRemove: () => void
}) {
  const set = <K extends keyof ChoiceDraft>(k: K, v: ChoiceDraft[K]) => onChange({ ...choice, [k]: v })
  return (
    <li className={cx('rounded-row', open && 'bg-surface-2/60 pb-2')}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 rounded-row px-2 text-left hover:bg-surface-hover">
          <Truncate className={cx('min-w-0 text-body', choice.name.trim() ? 'text-fg' : 'italic text-fg-muted')}>{choice.name.trim() || 'New choice'}</Truncate>
          <span className="ml-auto shrink-0 whitespace-nowrap text-meta tabular-nums text-fg-muted">{choiceSummary(choice, pick)}</span>
          <ChevronDown aria-hidden className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} />
        </button>
        <IconButton label={`Remove ${choice.name.trim() || 'this choice'}`} onClick={onRemove} className="h-8 w-8 shrink-0 text-fg-faint hover:!text-danger"><X /></IconButton>
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-2 pt-1">
          <label className="flex flex-col gap-1">
            <span className="text-micro font-semibold text-fg-muted">Name</span>
            <input value={choice.name} onChange={e => set('name', e.target.value)} maxLength={OPTION_LIMITS.name}
              placeholder={pick === 'size' ? 'e.g. Large' : 'e.g. Chicken'} className="input input-sm w-full" />
          </label>
          {pick === 'size' ? (
            <label className="flex flex-col gap-1">
              <span className="text-micro font-semibold text-fg-muted">Portions (×)</span>
              <DecimalInput value={choice.factor} onValue={v => set('factor', v)} aria-label="Portions (×)" placeholder="e.g. 1.5"
                className="input input-sm w-24 text-right tabular-nums" />
            </label>
          ) : (
            <div>
              <p className="mb-1 text-micro text-fg-muted">What it adds to one portion (kcal, then grams)</p>
              <div className="grid grid-cols-5 gap-1.5">
                {MACROS.map(m => (
                  <label key={m.key} className="flex min-w-0 flex-col gap-1">
                    <span className="text-micro font-semibold text-fg-muted">{m.label}</span>
                    <DecimalInput value={choice[m.key]} onValue={v => set(m.key, v)} aria-label={`${choice.name.trim() || 'Choice'}: ${m.key === 'kcal' ? 'kcal' : `${m.label.toLowerCase()} (g)`}`}
                      className="input input-sm w-full px-1.5 text-right tabular-nums" />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The preset form's Options: up to 3 groups of up to 6 choices that the card
 * asks about before it logs (migration 159). "Suggest options" lets the AI
 * draft them from the preset's name and values; the draft only fills this
 * form — the owner edits it and taps Save (review-first).
 */
export function QuickGuessOptionsField({ draft, onChange }: { draft: GuessDraft; onChange: (options: GroupDraft[]) => void }) {
  const suggest = useSuggestGuessOptions()
  const [open, setOpen] = useState<string | null>(null)
  // The options before the AI's suggestion replaced them ("Keep mine").
  const [before, setBefore] = useState<GroupDraft[] | null>(null)
  const groups = draft.options
  const edit = (next: GroupDraft[]) => { onChange(next); setBefore(null) }
  const setGroup = (gi: number, g: GroupDraft) => edit(groups.map((x, i) => (i === gi ? g : x)))
  const canSuggest = draft.name.trim() !== '' && draft.kcal != null && draft.kcal > 0

  async function runSuggest() {
    try {
      const suggested = await suggest.mutateAsync({
        name: draft.name.trim(), portion: draft.portion.trim(),
        calories: draft.kcal ?? 0, protein_g: draft.protein ?? 0, carbs_g: draft.carbs ?? 0, fat_g: draft.fat ?? 0, sugar_g: draft.sugar ?? 0,
      })
      setBefore(groups)
      onChange(suggested.map(groupToDraft))
      setOpen(null)
    } catch { /* the hook reports it; the form shows it below */ }
  }

  function addGroup() {
    edit([...groups, { name: '', pick: 'one', choices: [{ ...EMPTY_CHOICE }] }])
    setOpen(`${groups.length}:0`)
  }
  function addChoice(gi: number) {
    const g = groups[gi]
    setGroup(gi, { ...g, choices: [...g.choices, { ...EMPTY_CHOICE }] })
    setOpen(`${gi}:${g.choices.length}`)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="field-label mb-0">Options</p>
        <span className="text-meta text-fg-muted">asked before logging</span>
        <Button size="sm" variant="ghost" className="ml-auto -mr-1.5" icon={<Sparkles />} loading={suggest.isPending} disabled={!canSuggest}
          title={canSuggest ? 'The AI drafts option groups from the name and values; you edit them and Save' : 'Give it a name and kcal first'}
          onClick={() => { void runSuggest() }}>Suggest options</Button>
      </div>
      {before && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TonePill tone="info">AI suggestion</TonePill>
          <span className="text-meta text-fg-muted">check it, then Save</span>
          <button type="button" className={chipClass('quiet', 'ml-auto')} onClick={() => { onChange(before); setBefore(null) }}>
            {before.length ? 'Keep mine' : 'Clear'}
          </button>
        </div>
      )}
      {suggest.isError && !suggest.isPending && <p role="alert" className="text-meta text-danger">{suggest.error.message}</p>}
      {groups.length === 0 && !before && (
        <p className="text-meta text-fg-muted">None: a tap logs it at once. Add a group (e.g. “On it”, “Extra”, “Size”) to be asked first.</p>
      )}
      {groups.map((g, gi) => (
        <section key={gi} aria-label={g.name.trim() || `Option group ${gi + 1}`} className="rounded-row border border-line p-1.5">
          <div className="flex items-center gap-1.5">
            <input value={g.name} onChange={e => setGroup(gi, { ...g, name: e.target.value })} maxLength={OPTION_LIMITS.name}
              placeholder="e.g. On it" aria-label={`Option group ${gi + 1} name`} className="input input-sm min-w-0 flex-1" />
            <select value={g.pick} onChange={e => setGroup(gi, { ...g, pick: e.target.value as GuessPick })} aria-label={`How ${g.name.trim() || `group ${gi + 1}`} is picked`}
              className="select input-sm w-auto shrink-0">
              {PICKS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <IconButton label={`Remove ${g.name.trim() || `option group ${gi + 1}`}`} onClick={() => { edit(groups.filter((_, i) => i !== gi)); setOpen(null) }}
              className="h-8 w-8 shrink-0 text-fg-faint hover:!text-danger"><X /></IconButton>
          </div>
          <ul className="mt-1 flex flex-col">
            {g.choices.map((c, ci) => (
              <ChoiceRow key={ci} choice={c} pick={g.pick} open={open === `${gi}:${ci}`}
                onToggle={() => setOpen(o => (o === `${gi}:${ci}` ? null : `${gi}:${ci}`))}
                onChange={next => setGroup(gi, { ...g, choices: g.choices.map((x, i) => (i === ci ? next : x)) })}
                onRemove={() => { setGroup(gi, { ...g, choices: g.choices.filter((_, i) => i !== ci) }); setOpen(null) }} />
            ))}
          </ul>
          {g.choices.length < OPTION_LIMITS.choices && (
            <button type="button" onClick={() => addChoice(gi)} className={chipClass('quiet', 'ml-0.5')}><Plus aria-hidden /> Choice</button>
          )}
        </section>
      ))}
      {groups.length < OPTION_LIMITS.groups && (
        <button type="button" onClick={addGroup} className={chipClass('quiet', 'self-start -ml-1.5')}><Plus aria-hidden /> Option group</button>
      )}
    </div>
  )
}
