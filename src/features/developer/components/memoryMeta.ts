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
