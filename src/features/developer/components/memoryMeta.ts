import type { AiMemory } from '../../ai/api/memoryApi'

// Split out from MemoryRow.tsx — a component file can only export components
// for Fast Refresh to work, not also share constants (same reasoning as
// devRequestMeta.ts).
export const KIND_BADGE: Record<AiMemory['kind'], string> = {
  fact:       'bg-blue-50 text-blue-700 border-blue-200',
  preference: 'bg-violet-50 text-violet-700 border-violet-200',
  summary:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  note:       'bg-ink-100 text-ink-600 border-ink-200',
}

export const KIND_LABEL: Record<AiMemory['kind'], string> = {
  fact:       'Fact',
  preference: 'Preference',
  summary:    'Summary',
  note:       'Note',
}

export const KINDS: AiMemory['kind'][] = ['fact', 'preference', 'note', 'summary']
