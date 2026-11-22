import { supabase } from '../../../integrations/supabase/client'
import { currentUserId } from '../../../shared/utils/requireUser'
import { runClaudeJob } from '../../ai/claude/claudeApi'
import { todayStr } from '../../../shared/utils/dateUtils'
import { gatherCoachData } from '../coach/coachData'
import { formatPtSnapshot } from '../coach/coachFormat'
import { formatPtVerdicts, ptVerdicts, type PtFeeling } from '../coach/coachFacts'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT coach — daily assessment. AI last: all data is gathered and pre-aggregated here into ONE compact text
//  snapshot, and the decisions the assessment rules make from it (rest day, deload cue, the one lift to focus on)
//  are worked out by code too (coach/coachFacts.ts). One call to the `coach_assessment` job of the `claude`
//  function then explains them: no tool loop, no database access for the model. The snapshot comes from the
//  shared coach context (coach/coachData.ts + coach/coachFormat.ts), the same data Ask-AI Coach mode reads.
// ─────────────────────────────────────────────────────────────────────────────

/** What the function takes at most (job-coach.ts COACH_LIMITS): longer text is cut at a whole line, never mid-line. */
const SNAPSHOT_MAX = 8000
const PREVIOUS_MAX = 2000
const NOTE_MAX = 300

export async function buildTrainingSnapshot(): Promise<string> {
  return fitLines(formatPtSnapshot(await gatherCoachData()), SNAPSHOT_MAX)
}

/** `text`, or its first lines that fit in `max` characters (the least important come last in the snapshot). */
export function fitLines(text: string, max: number): string {
  if (text.length <= max) return text
  const kept: string[] = []
  let size = 0
  for (const line of text.split('\n')) {
    if (size + line.length + 1 > max) break
    kept.push(line)
    size += line.length + 1
  }
  return kept.join('\n')
}

export interface PTAssessmentInput {
  feeling:  PtFeeling     // "az çalıştım" | "normal" | "yorgunum" | "çok yorgunum"
  note?:    string        // free text
}

export interface PTAssessmentRow {
  id:         string
  date:       string
  feeling:    string
  note:       string | null
  assessment: string
  model:      string | null
  created_at: string
}

// Assessment history — the coach's own log. Newest first.
export async function fetchAssessments(limit = 14): Promise<PTAssessmentRow[]> {
  const { data, error } = await supabase
    .from('pt_assessments')
    .select('id, date, feeling, note, assessment, model, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export interface PTAssessmentResult { text: string; model: string | null }

export async function generatePTAssessment(input: PTAssessmentInput): Promise<PTAssessmentResult> {
  const data = await gatherCoachData()
  const snapshot = fitLines(formatPtSnapshot(data), SNAPSHOT_MAX)
  const verdicts = formatPtVerdicts(ptVerdicts(data, input.feeling))

  // The coach's continuity: hand it its own last assessment so it can follow
  // up on whether the advice was applied (the job's FOLLOW-UP rule).
  let previous: string | undefined
  try {
    const [prev] = await fetchAssessments(1)
    if (prev) previous = `(${prev.date}, owner felt: ${prev.feeling})\n${prev.assessment}`.slice(0, PREVIOUS_MAX)
  } catch { /* history is optional (table may not exist pre-migration) */ }

  const { result, call } = await runClaudeJob<{ text?: unknown }>('coach_assessment', {
    feeling: input.feeling,
    ...(input.note ? { note: input.note.slice(0, NOTE_MAX) } : {}),
    snapshot, verdicts, ...(previous ? { previous } : {}),
  })
  const text = typeof result?.text === 'string' ? result.text.trim() : ''
  if (!text) throw new Error("The coach didn't send an assessment — try again")
  // The model that really answered, as the function says it (not the one asked for).
  const model = call?.served_model ?? call?.model ?? null

  // Persist the log — best-effort (an insert failure must not eat the reply).
  try {
    const userId = await currentUserId()
    if (userId) {
      await supabase.from('pt_assessments').insert({
        user_id:    userId,
        date:       todayStr(),
        feeling:    input.feeling,
        note:       input.note ?? null,
        snapshot:   `${verdicts}\n\n${snapshot}`,
        assessment: text,
        model,
      })
    }
  } catch { /* logged assessment is a bonus, not a gate */ }

  return { text, model }
}
