import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button, Card, SectionLabel, Switch } from '../../../../shared/ui'
import { useSaveChatInstructions, useSaveToolSettings } from '../../../ai/claude/hooks/useClaude'
import type { ToolMode } from '../../../ai/claude/ledgerApi'
import { chatToolModes } from '../../../ai/claude/ledgerRules'
import type { Describe, DescribeChatTool } from '../../../ai/claude/types'
import { TOOL_LABELS } from '../../../ai/chat/chatRules'

// Developer → AI → Settings: what Ask AI may do (a mode for each tool) and the owner's own words for it. Both are saved
// where the browser can write, so the function treats them as input: it takes only the tools and modes it knows, never
// lets a write tool be "allowed", cleans the words, and copies both into a NEW chat (a chat keeps what it started with).

const USED_BY: Record<string, string> = { chat: 'Ask AI', coach: 'Coach', phone: 'Phone' }

/** A read tool is on or off (a switch); a write tool asks first or is off (a choice): one control each, plain words. */
function ToolRow({ tool, mode, onChange }: { tool: DescribeChatTool; mode: ToolMode; onChange: (mode: ToolMode) => void }) {
  const label = TOOL_LABELS[tool.name]?.label ?? tool.name
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-fg">{label}</p>
        <p className="text-meta text-fg-muted">{TOOL_LABELS[tool.name]?.what ?? tool.what}</p>
        <p className="text-meta text-fg-faint">Used by: {tool.chats.map(c => USED_BY[c]).filter(Boolean).join(', ')}</p>
      </div>
      {tool.kind === 'write' ? (
        <select value={mode} onChange={e => onChange(e.target.value === 'off' ? 'off' : 'ask')} aria-label={`${label}: mode`} className="select w-28 shrink-0">
          <option value="ask">Ask first</option>
          <option value="off">Off</option>
        </select>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-meta font-medium text-fg-2">
          {mode === 'off' ? 'Off' : 'On'}
          <Switch on={mode !== 'off'} onChange={v => onChange(v ? 'on' : 'off')} label={`${label}: switched on`} />
        </span>
      )}
    </li>
  )
}

export function ChatToolsCard({ about, stored }: { about: Describe; stored: readonly { tool: string; mode: string }[] }) {
  const save = useSaveToolSettings()
  const tools = about.chat.tools
  const saved = chatToolModes(tools, stored)
  const [modes, setModes] = useState(saved)
  const [open, setOpen] = useState(false)
  const changed = tools.filter(t => modes[t.name] !== saved[t.name])
  const onCount = tools.filter(t => modes[t.name] !== 'off').length
  return (
    <Card className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <SectionLabel>Chat tools ({onCount} on)</SectionLabel>
        <ChevronRight className={`h-4 w-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      <p className="text-meta text-fg-muted">
        What Ask AI, the coach and the phone’s question may look up or propose. Off stops a tool at once, even in a chat that is already open.
        Anything else you change reaches chats you start after saving: a chat keeps the tools it began with.
      </p>
      {open && (
        <>
          <ul className="divide-y divide-line">
            {tools.map(t => <ToolRow key={t.name} tool={t} mode={modes[t.name]} onChange={m => setModes(cur => ({ ...cur, [t.name]: m }))} />)}
          </ul>
          <p className="text-meta text-fg-muted">
            Reading changes nothing, so a tool that only reads has no “ask first”: it is on, and Off stops it. A tool that proposes something can only Ask first
            (nothing is saved until you tap Confirm) or be Off. The phone never writes and never takes photos: it uses only the read tools marked for it.
            The model cannot change any of this.
          </p>
        </>
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={changed.length === 0} loading={save.isPending}
          onClick={() => save.mutate(changed.map(t => ({ tool: t.name, mode: modes[t.name] })))}>Save</Button>
      </div>
    </Card>
  )
}

export function ChatInstructionsCard({ about, stored }: { about: Describe; stored: string }) {
  const save = useSaveChatInstructions()
  const max = about.chat.limits.ownerInstructionsMax
  const [text, setText] = useState(stored)
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <SectionLabel>Your instructions</SectionLabel>
        <p className="text-meta text-fg-muted">
          Your own words for Ask AI, the coach and the phone’s answers, for example “answer in short sentences” or “I train in the mornings”. Every new chat starts with them,
          saved exactly as you type them. They change how it talks, never its safety rules: they cannot let it save anything without your Confirm tap.
          A chat keeps the words it started with.
        </p>
      </div>
      <div>
        <textarea value={text} onChange={e => setText(e.target.value.slice(0, max))} rows={3} aria-label="Your instructions for Ask AI" placeholder="Nothing yet" className="input w-full resize-y" />
        <p className="mt-1 text-meta tabular-nums text-fg-faint">{[...text].length} / {max}</p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={text === stored} loading={save.isPending} onClick={() => save.mutate(text)}>Save</Button>
      </div>
    </Card>
  )
}
