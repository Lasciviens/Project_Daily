// The words Developer → AI uses, each in plain words with an everyday example (the owner is learning the
// vocabulary: AGENTS.md). Shown on How it works; the short forms explain a label where it is first met.

export interface GlossaryTerm { term: string; what: string }

export const AI_GLOSSARY: readonly GlossaryTerm[] = [
  { term: 'Token', what: 'A piece of text, about ¾ of a word. The model reads and writes in tokens and Anthropic bills by them: “Dentist on Tuesday at 14:00” is about 8 tokens.' },
  { term: 'MTok', what: 'A million tokens. Prices are per MTok: at $0.10 per MTok, 1 000 tokens cost $0.0001.' },
  { term: 'Prompt', what: 'Everything sent to the model in one call: the job’s fixed instructions, then your text.' },
  { term: 'Input and output', what: 'Input is what we send, output is what the model writes back. Output costs more per token than input (the Prices view has both).' },
  { term: 'Cache', what: 'The part of a prompt that repeats — the fixed instructions — is stored at Anthropic for a few minutes. Storing it (“written”) costs a little more than normal input; reading it back (“cached”) costs a small part of it.' },
  { term: 'Thinking', what: 'The model’s reasoning before it answers. It is billed as output. The log keeps a summary of it, so you can see why it answered as it did. In the Test bench it can be switched off, to see what it costs and how much time it takes.' },
  { term: 'Effort', what: 'How much the model reasons before it answers: low, medium or high. Low is the fastest and cheapest and suits a form fill; high suits a hard question.' },
  { term: 'Model', what: 'Which Claude answers. Haiku is the fastest and cheapest; Sonnet and Opus are stronger and cost more.' },
  { term: 'Longest answer', what: 'A ceiling on the output tokens of one answer. Thinking counts toward it; an answer that reaches it is cut off and not used.' },
  { term: 'Structured output', what: 'The answer must fit a fixed shape (a schema), so the app gets fields instead of prose. The app still checks every field itself.' },
  { term: 'Job', what: 'One thing the app asks the model to do, with its own instructions, settings and budget. ✨ on the item screen is the job item_fill.' },
  { term: 'Budget', what: 'A ceiling on a month’s cost, counted on Oslo’s calendar. It is a wall, not a warning: when it is reached, calls stop until next month or a higher budget.' },
  { term: 'Ledger', what: 'The log of every call — its tokens, cost, time and how it ended. The Calls view shows it.' },
]

/** One term's plain words, for a label's ⓘ. */
export function glossaryOf(term: string): string {
  return AI_GLOSSARY.find(g => g.term === term)?.what ?? ''
}
