import { ShieldOff, Trash2, Undo2 } from 'lucide-react'
import { Button, Truncate } from '../../../../../shared/ui'
import { useLearnCases, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { CASE_STATE_LABEL, jobWords, type AiCase, type CaseState } from '../../../../ai/claude/learnRules'
import { Group, Pairs, ReadState, StatePill } from './memoryBits'
import { day } from './memoryDay'

// Cases: answers the owner saved (typed by the owner, or read text the owner confirmed by saving), found again by their words
// and sent with a similar call as data. Set one aside (quarantine) or remove it; both have an Undo. A case expires by itself.

const SPLIT_LABEL = { train: 'example', test: 'test', sealed: 'kept back' } as const

function Row({ c, onState, busy }: { c: AiCase; onState: (state: CaseState) => void; busy: boolean }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <Truncate as="p" lines={2} className="min-w-0 flex-1 text-body text-fg">{c.input_text}</Truncate>
        <StatePill tone={c.state === 'active' ? 'success' : 'neutral'}>{CASE_STATE_LABEL[c.state]}</StatePill>
      </div>
      <Pairs pairs={c.output.slice(0, 8)} />
      <p className="text-meta text-fg-muted">
        {jobWords(c.job)} · {c.source_kind === 'owner_typed' ? 'your words' : 'confirmed by your save'} · {SPLIT_LABEL[c.split]}{c.changed ? ` · ${c.changed} changed` : ''} · {day(c.created_at)} · expires {day(c.expires_at)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {c.state === 'active' && <Button size="sm" variant="ghost" icon={<ShieldOff />} disabled={busy} onClick={() => onState('quarantined')}>Set aside</Button>}
        {c.state === 'active' && <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={busy} onClick={() => onState('removed')}>Remove</Button>}
        {c.state !== 'active' && <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('active')}>Use again</Button>}
      </div>
    </li>
  )
}

export function MemoryCases() {
  const q = useLearnCases()
  const set = useSetLearnState()
  const list = q.data ?? []
  const said: Record<CaseState, string> = { active: 'Case in use again', quarantined: 'Case set aside', removed: 'Case removed' }
  const change = (c: AiCase, state: CaseState) => set.mutate({ table: 'ai_cases', id: c.id, state, said: said[state] })
  const active = list.filter(c => c.state === 'active')
  const aside = list.filter(c => c.state !== 'active')
  return (
    <>
      <ReadState query={q} what="the cases" count={list.length} empty="No cases yet. Each time you save what an AI filled, your saved answer becomes a case that similar calls get as an example." />
      <Group title="In use" count={active.length}>{active.map(c => <Row key={c.id} c={c} busy={set.isPending} onState={s => change(c, s)} />)}</Group>
      <Group title="Set aside or removed" count={aside.length}>{aside.map(c => <Row key={c.id} c={c} busy={set.isPending} onState={s => change(c, s)} />)}</Group>
    </>
  )
}
