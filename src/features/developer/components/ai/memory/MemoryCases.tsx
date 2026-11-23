import { ShieldOff, Undo2 } from 'lucide-react'
import { Button, Truncate } from '../../../../../shared/ui'
import { useLearnCases, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { CASE_STATE_LABEL, fieldWords, jobWords, LEARN_WIRED, type AiCase, type CaseState } from '../../../../ai/claude/learnRules'
import { Group, Pairs, ReadState, StatePill } from './memoryBits'
import { day, useValueWords } from './memoryDay'

// Cases: answers the owner saved (typed by the owner, or read text the owner only confirmed by saving), found again by their
// words and sent with a similar call as data. Set one aside and use it again, both with an Undo; a case expires by itself.

const SPLIT_LABEL = { train: 'example', test: 'test', sealed: 'kept back' } as const

function Row({ c, onState, busy, words }: { c: AiCase; onState: (state: CaseState) => void; busy: boolean; words: (field: string, value: string | null) => string }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <Truncate as="p" lines={2} className="min-w-0 flex-1 text-body text-fg">{c.input_text}</Truncate>
        <StatePill tone={c.state === 'active' ? 'success' : 'neutral'}>{CASE_STATE_LABEL[c.state]}</StatePill>
      </div>
      <Pairs pairs={c.output.slice(0, 8).map(([k, v]) => [fieldWords(k).replace(/ id$/, ''), words(k, v)])} />
      <p className="text-meta text-fg-muted">
        {jobWords(c.job)} · {c.source_kind === 'owner_typed' ? 'your words' : 'read text you saved (the input not confirmed)'} · {SPLIT_LABEL[c.split]}{c.changed ? ` · ${c.changed} changed` : ''} · {day(c.created_at)} · expires {day(c.expires_at)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {c.state === 'active'
          ? <Button size="sm" variant="ghost" icon={<ShieldOff />} disabled={busy} onClick={() => onState('quarantined')}>Set aside</Button>
          : <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('active')}>Use again</Button>}
      </div>
    </li>
  )
}

export function MemoryCases() {
  const q = useLearnCases()
  const set = useSetLearnState()
  const words = useValueWords()
  const list = q.data ?? []
  const said: Record<CaseState, string> = { active: 'Case in use again', quarantined: 'Case set aside', removed: 'Case turned off' }
  const change = (c: AiCase, state: CaseState) => set.mutate({ table: 'ai_cases', id: c.id, state, said: said[state] })
  const active = list.filter(c => c.state === 'active')
  const aside = list.filter(c => c.state !== 'active')
  const row = (c: AiCase) => <Row key={c.id} c={c} busy={set.isPending} words={words} onState={s => change(c, s)} />
  return (
    <>
      <ReadState query={q} what="the cases" count={list.length} empty={`No cases yet. Each answer you save becomes a case that similar calls get as an example: ${LEARN_WIRED}`} />
      <Group title="In use" count={active.length}>{active.map(row)}</Group>
      <Group title="Set aside" count={aside.length}>{aside.map(row)}</Group>
    </>
  )
}
