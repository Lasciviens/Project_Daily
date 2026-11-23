import { EyeOff, Undo2 } from 'lucide-react'
import { Button } from '../../../../../shared/ui'
import { useLearnSources, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { jobWords, type AiSource } from '../../../../ai/claude/learnRules'
import { Group, ReadState, StatePill } from './memoryBits'
import { day } from './memoryDay'

// Sites (source memory): per job and site, how reading a page went. Code uses it only to put sites that read well first when it
// has several to choose from; it is never a link the app follows by itself, and every page read keeps its own guards. A site
// shown here is a name only (never a whole address). Ignore takes a site out of the ordering, with an Undo.

const REASON: Record<string, string> = { read_by_code: 'read by code, no AI', text_to_model: 'page read, the AI wrote it', failed: 'could not be read' }

function Row({ s, onState, busy }: { s: AiSource; onState: (state: 'on' | 'ignored') => void; busy: boolean }) {
  const total = s.ok + s.fail
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all text-body font-medium text-fg">{s.host}</p>
        <StatePill tone={s.state === 'ignored' ? 'neutral' : s.fail > s.ok ? 'warn' : 'success'}>{s.state === 'ignored' ? 'Ignored' : `${s.ok} of ${total} read`}</StatePill>
      </div>
      <p className="text-meta text-fg-muted">{jobWords(s.job)}{s.last_reason ? ` · last: ${REASON[s.last_reason] ?? s.last_reason}` : ''}{s.last_ok_at ? ` · last good ${day(s.last_ok_at)}` : ''}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.state === 'on'
          ? <Button size="sm" variant="ghost" icon={<EyeOff />} disabled={busy} onClick={() => onState('ignored')}>Ignore</Button>
          : <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('on')}>Use again</Button>}
      </div>
    </li>
  )
}

export function MemorySources() {
  const q = useLearnSources()
  const set = useSetLearnState()
  const list = q.data ?? []
  const change = (s: AiSource, state: 'on' | 'ignored') => set.mutate({ table: 'ai_source_stats', id: s.id, state, said: state === 'ignored' ? 'Site ignored' : 'Site used again' })
  return (
    <>
      <ReadState query={q} what="the sites" count={list.length} empty="No sites yet. Each recipe link you read is counted here by its site." />
      <Group title="Sites" count={list.length}>{list.map(s => <Row key={s.id} s={s} busy={set.isPending} onState={st => change(s, st)} />)}</Group>
    </>
  )
}
