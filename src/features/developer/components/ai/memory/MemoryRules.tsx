import { Check, PowerOff } from 'lucide-react'
import { Button } from '../../../../../shared/ui'
import { useLearnRules, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { jobWords, RULE_STATE_LABEL, type AiRule, type RuleState } from '../../../../ai/claude/learnRules'
import { Group, ReadState, StatePill } from './memoryBits'
import { count, day, useValueWords } from './memoryDay'

// Rules: the same fix made three times, proposed by the function and turned on ONLY by the owner's tap (the database refuses
// the function). Code applies an active rule with no AI call, through the job's own check; when a thing's rules cover every
// field, no AI is asked at all. Each rule says where it came from and can be turned off and on again, always with an Undo.

function Row({ r, onState, busy, words }: { r: AiRule; onState: (state: RuleState) => void; busy: boolean; words: (field: string, value: string | null) => string }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-body text-fg">
          When <span className="font-medium">“{r.match_key}”</span>, {r.field.replace(/_/g, ' ').replace(/ id$/, '')} is <span className="font-medium">{words(r.field, r.value)}</span>
        </p>
        <StatePill tone={r.state === 'active' ? 'success' : r.state === 'proposed' ? 'accent' : 'neutral'}>{RULE_STATE_LABEL[r.state]}</StatePill>
      </div>
      <p className="text-meta tabular-nums text-fg-muted">
        {jobWords(r.job)} · from {count(r.evidence)} of your fixes · since {day(r.created_at)}{r.state === 'active' ? ` · used ${count(r.uses)} ${r.uses === 1 ? 'time' : 'times'}` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {r.state !== 'active' && <Button size="sm" icon={<Check />} disabled={busy} onClick={() => onState('active')}>Turn on</Button>}
        {r.state !== 'removed' && <Button size="sm" variant="ghost" icon={<PowerOff />} disabled={busy} onClick={() => onState('removed')}>Turn off</Button>}
      </div>
    </li>
  )
}

export function MemoryRules() {
  const q = useLearnRules()
  const set = useSetLearnState()
  const words = useValueWords()
  const list = q.data ?? []
  const said: Record<RuleState, string> = { active: 'Rule turned on', removed: 'Rule turned off', proposed: 'Rule waiting again' }
  const change = (r: AiRule, state: RuleState) => set.mutate({ table: 'ai_rules', id: r.id, state, said: said[state] })
  const by = (s: RuleState) => list.filter(r => r.state === s)
  const row = (r: AiRule) => <Row key={r.id} r={r} busy={set.isPending} words={words} onState={s => change(r, s)} />
  return (
    <>
      <ReadState query={q} what="the rules" count={list.length} empty="No rules yet. When you fix the same field of the same thing to the same value three times, a rule is proposed here." />
      <Group title="Waiting for you" count={by('proposed').length}>{by('proposed').map(row)}</Group>
      <Group title="On" count={by('active').length}>{by('active').map(row)}</Group>
      <Group title="Off" count={by('removed').length}>{by('removed').map(row)}</Group>
    </>
  )
}
