import { useState } from 'react'
import { Button, Card, SectionLabel } from '../../../../shared/ui'
import { useSaveChatInstructions, useSaveToolSettings } from '../../../ai/claude/hooks/useClaude'
import type { ToolMode } from '../../../ai/claude/ledgerApi'
import { chatToolModes } from '../../../ai/claude/ledgerRules'
import type { Describe, DescribeChatTool } from '../../../ai/claude/types'
import { TOOL_LABELS } from '../../../ai/chat/chatRules'

// Developer → AI → Settings: what Ask AI may do (a mode for each tool) and the owner's own words for it. Both are saved
// where the browser can write, so the function treats them as input: it takes only the tools and modes it knows, never
// lets a write tool be "allowed", cleans the words, and copies both into a NEW chat (a chat keeps what it started with).

const MODE_LABEL: Record<ToolMode, string> = { on: 'Allowed', ask: 'Ask first', off: 'Off' }

function ToolRow({ tool, mode, onChange }: { tool: DescribeChatTool; mode: ToolMode; onChange: (mode: ToolMode) => void }) {
  const label = TOOL_LABELS[tool.name]?.label ?? tool.name
  // A write tool can only ask or be off; a read tool is allowed or off.
  const choices: ToolMode[] = tool.kind === 'write' ? ['ask', 'off'] : ['on', 'off']
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-fg">{label}</p>
        <p className="text-meta text-fg-muted">{TOOL_LABELS[tool.name]?.what ?? tool.what}</p>
      </div>
      <select value={mode} onChange={e => onChange(e.target.value as ToolMode)} aria-label={`${label}: mode`} className="select w-28 shrink-0">
        {choices.map(c => <option key={c} value={c}>{MODE_LABEL[c]}</option>)}
      </select>
    </li>
  )
}

export function ChatToolsCard({ about, stored }: { about: Describe; stored: readonly { tool: string; mode: string }[] }) {
  const save = useSaveToolSettings()
  const tools = about.chat.tools
  const saved = chatToolModes(tools, stored)
  const [modes, setModes] = useState(saved)
  const changed = tools.filter(t => modes[t.name] !== saved[t.name])
  const group = (title: string, list: DescribeChatTool[]) => (list.length === 0 ? null : (
    <div>
      <p className="mt-1 text-meta font-semibold uppercase tracking-wide text-fg-faint">{title}</p>
      <ul className="divide-y divide-line">{list.map(t => <ToolRow key={t.name} tool={t} mode={modes[t.name]} onChange={m => setModes(cur => ({ ...cur, [t.name]: m }))} />)}</ul>
    </div>
  ))
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <SectionLabel>Chat tools</SectionLabel>
        <p className="text-meta text-fg-muted">
          What Ask AI may use. A tool that is Off is not offered to a new chat, and is refused even in a chat that already started.
          Allowed and Ask first apply to chats you start after saving: a chat keeps the tools it began with.
          A tool that proposes something can only Ask first: nothing it proposes is saved until you tap Confirm.
        </p>
      </div>
      {group('Ask AI', tools.filter(t => t.chats.includes('chat')))}
      {group('Coach chat only', tools.filter(t => !t.chats.includes('chat')))}
      <p className="text-meta text-fg-muted">Get day plan and About me are also the coach chat’s. The model never changes these settings: they are not in its tool list.</p>
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
          Your own words for Ask AI, for example “answer in short sentences” or “I train in the mornings”. They are added after its fixed rules in every new chat,
          saved exactly as you type them. They change how it talks, never its rules: they cannot let it save anything without your Confirm tap.
          A chat keeps the words it started with.
        </p>
      </div>
      <div>
        <textarea value={text} onChange={e => setText(e.target.value.slice(0, max))} rows={4} aria-label="Your instructions for Ask AI" placeholder="Nothing yet" className="input w-full resize-y" />
        <p className="mt-1 text-meta tabular-nums text-fg-faint">{[...text].length} / {max}</p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={text === stored} loading={save.isPending} onClick={() => save.mutate(text)}>Save</Button>
      </div>
    </Card>
  )
}
