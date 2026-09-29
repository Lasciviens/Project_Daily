import type { AiMemory } from '../../ai/api/memoryApi'
import type { Tone } from '../../../shared/ui'

// Split out from MemoryRow.tsx — a component file can only export components
// for Fast Refresh to work, not also share constants.
export const KIND_TONE: Record<AiMemory['kind'], Tone> = {
  fact:       'info',
  preference: 'highlight',
  summary:    'success',
  note:       'neutral',
}

export const KIND_LABEL: Record<AiMemory['kind'], string> = {
  fact:       'Fact',
  preference: 'Preference',
  summary:    'Summary',
  note:       'Note',
}

export const KINDS: AiMemory['kind'][] = ['fact', 'preference', 'note', 'summary']

export const SOURCE_LABEL: Record<AiMemory['source'], string> = {
  user: 'You added this',
  ai:   'AI saved this',
  auto: 'Saved automatically',
}

/** An edit in progress (the sheet on phones, the detail pane on wider pages). */
export interface MemoryDraft {
  kind: AiMemory['kind']
  title: string
  content: string
}

export const draftOf = (m: Pick<AiMemory, 'kind' | 'title' | 'content'>): MemoryDraft => ({ kind: m.kind, title: m.title, content: m.content })
export const draftValid = (d: MemoryDraft) => !!d.title.trim() && !!d.content.trim()
export const draftChanged = (d: MemoryDraft, m: Pick<AiMemory, 'kind' | 'title' | 'content'>) =>
  d.kind !== m.kind || d.title.trim() !== m.title || d.content.trim() !== m.content
