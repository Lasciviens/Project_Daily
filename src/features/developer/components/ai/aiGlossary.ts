// The words Developer → AI uses, each in plain words with an everyday example (the owner is learning the
// vocabulary: AGENTS.md). Shown on How it works; the short forms explain a label where it is first met.

export interface GlossaryTerm { term: string; what: string }

export const AI_GLOSSARY: readonly GlossaryTerm[] = [
  { term: 'Token', what: 'A piece of text, about ¾ of a word. The model reads and writes in tokens and Anthropic bills by them: “Dentist on Tuesday at 14:00” is about 8 tokens.' },
  { term: 'MTok', what: 'A million tokens. Prices are per MTok: at $0.10 per MTok, 1 000 tokens cost $0.0001.' },
  { term: 'Prompt', what: 'Everything sent to the model in one call: the job’s fixed instructions, then your text.' },
  { term: 'Input and output', what: 'Input is what we send, output is what the model writes back. Output costs more per token than input (the Prices view has both).' },
  { term: 'Cache', what: 'The part of a prompt that repeats — the fixed instructions — is stored at Anthropic for a few minutes. Storing it (“written”) costs a little more than normal input; reading it back (“cached”) costs a small part of it.' },
  { term: 'Thinking', what: 'The model’s reasoning before it answers. It is billed as output. The log keeps a summary of it, so you can see why it answered as it did. Each job can switch it off in Settings (it stays on, “adaptive”, until a job’s answers are measured to be as good without it), and the Test bench compares the two.' },
  { term: 'Adaptive thinking', what: 'The model decides how much to reason: a simple form fill may think for a moment, a hard question longer. You do not set a number of thinking tokens. The alternative is “off”: no reasoning at all, which costs less and answers faster.' },
  { term: 'Effort', what: 'How much the model reasons before it answers: low, medium or high. Low is the fastest and cheapest and suits a form fill; high suits a hard question.' },
  { term: 'Model', what: 'Which Claude answers. Haiku is the fastest and cheapest; Sonnet and Opus are stronger and cost more.' },
  { term: 'Longest answer', what: 'A ceiling on the output tokens of one answer. Thinking counts toward it; an answer that reaches it is cut off and not used.' },
  { term: 'Structured output', what: 'Not used now. Anthropic can force an answer to fit a fixed shape (a schema), but a shape with many optional fields took up to 90 seconds to prepare in a live test. So each job writes its shape into its instructions and the app’s own check holds every field, dropping what does not fit.' },
  { term: 'Job', what: 'One thing the app asks the model to do, with its own instructions, settings and budget. ✨ on the item screen is the job item_fill.' },
  { term: 'Budget', what: 'A ceiling on a month’s cost, counted on Oslo’s calendar. It is a wall, not a warning: when it is reached, calls stop until next month or a higher budget.' },
  { term: 'Reserved (held at worst case)', what: 'Before a call is sent, the most it could cost is set aside from your monthly budget, so a burst of calls cannot overspend it. When the real numbers arrive the hold is replaced by the real cost. If they never do (a timeout: Anthropic may still have billed it), the hold stays and the call is shown as “held at worst case”: the real bill is unknown, and the Console has the official one.' },
  { term: 'Stop reason', what: 'Why the model stopped writing: “end_turn” is a finished answer, “max_tokens” means it hit the longest-answer limit and was cut off, “refusal” means it declined.' },
  { term: 'Request id', what: 'The number Anthropic gives every request. Quote it to their support, or look it up in their Console, to see exactly what happened to that call.' },
  { term: 'Rate cap', what: 'A fixed limit on how fast calls may come, set in the function’s code (its numbers are on How it works). Over a cap the answer is “busy” and nothing is sent. The account has a limit a minute and a day, each device (the Kobo, the phone) has its own daily limit, and the Test bench’s free token count has a few a minute.' },
  { term: 'Ledger', what: 'The log of every call — its tokens, cost, time and how it ended. The Calls view shows it.' },
]

/** One term's plain words, for a label's ⓘ. */
export function glossaryOf(term: string): string {
  return AI_GLOSSARY.find(g => g.term === term)?.what ?? ''
}
