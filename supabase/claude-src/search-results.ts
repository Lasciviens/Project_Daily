// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · search results
//
//  Every `search_result` block a request carries is built here, by one function, so all of them set citations the
//  same way. Anthropic refuses a request whose search results disagree ("Citations must be either enabled or disabled
//  on all search_result blocks", 400): find_text once had citations on while search_docs and get_about_me left the
//  field out, and a chat that used both could never be sent again (owner's report, 26.11.2026).
//
//    on     a chat or phone tool result: the model may cite it (only find_text's own rows are ever shown as links);
//    unset  no citations field: a one-shot job's learned knowledge (a job with an answer shape may not use citations),
//           and the results of a chat begun before this rule whose stored results already had none.
//
//  `verify-claude-chat` §19 fails when any other part writes a search_result block itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { Block } from './types.ts'

/** How the search results of one request set citations: one value per request, never a mix. */
export type SearchCitations = 'on' | 'unset'

/** One search result: where it came from (a label the model reads), its title, and its text. */
export interface SearchHit { source: string; title: string; text: string }

/** One `search_result` block, citations set by `cite`. */
export function searchResultBlock(hit: SearchHit, cite: SearchCitations = 'on'): Block {
  return {
    type: 'search_result', source: hit.source, title: hit.title, content: [{ type: 'text', text: hit.text }],
    ...(cite === 'on' ? { citations: { enabled: true } } : {}),
  }
}

/** How one stored search result sets citations: `on` only for exactly `{ enabled: true }`, `unset` with no field; anything else is not ours. */
function citationsOf(block: Block): SearchCitations | 'other' {
  if (!('citations' in block)) return 'unset'
  const c = block.citations
  return c !== null && typeof c === 'object' && (c as Record<string, unknown>).enabled === true && Object.keys(c as object).length === 1 ? 'on' : 'other'
}

/** Every search_result block inside the tool results of these messages. */
function storedSearchResults(messages: readonly { content: Block[] }[]): Block[] {
  const out: Block[] = []
  for (const m of messages) {
    for (const block of m.content) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      for (const inner of block.content as Block[]) if (inner.type === 'search_result') out.push(inner)
    }
  }
  return out
}

/**
 * The citation setting a chat's new search results must use: the one its stored results already use (the history is
 * replayed unchanged, so the new ones follow it), `on` for a chat that has none yet. `null` when the stored history
 * already mixes them: Anthropic refuses every request of that chat, so it is never sent again.
 */
export function chatCitations(messages: readonly { content: Block[] }[]): SearchCitations | null {
  const seen = new Set(storedSearchResults(messages).map(citationsOf))
  if (seen.has('other') || seen.size > 1) return null
  return seen.has('unset') ? 'unset' : 'on'
}

/** A tool's result blocks with every search result set to `cite` (built again by `searchResultBlock`); other blocks unchanged. */
export function withCitations(blocks: readonly Block[], cite: SearchCitations): Block[] {
  return blocks.map(block => {
    if (block.type !== 'search_result') return block
    const inner = Array.isArray(block.content) ? block.content as Block[] : []
    const text = inner.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
    return searchResultBlock({ source: String(block.source ?? ''), title: String(block.title ?? ''), text }, cite)
  })
}
