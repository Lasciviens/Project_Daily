import { fetchFoodLogRange } from '../../recipes/api/foodLogApi'
import { fetchAssessments } from '../../training/api/ptCoachApi'
import { gatherCoachData } from '../../training/coach/coachData'
import { buildCoachJson } from '../../training/coach/coachFormat'
import { shiftDateStr } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  Coach-mode chat context: the user's last 30 days as ONE compact JSON blob,
//  prepared client-side so the model doesn't burn turns exploring the DB.
//  JSON (minified, short keys) chosen deliberately: models parse it reliably
//  and it compresses repetitive numeric series far better than prose.
//  Attached ONLY in coach mode — normal chat keeps its lean generic context.
//  The training part is the shared coach context (training/coach/), the same
//  one the PT Coach tab reads: current program, the progress engine's
//  decisions and the athlete's limitations, so chat and assessment agree
//  with the Progress tab. Nutrition and past assessments are added here.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 30

export async function buildCoachContext(): Promise<string> {
  const data = await gatherCoachData()
  const ctx = buildCoachJson(data, WINDOW_DAYS)
  const from = shiftDateStr(data.today, -WINDOW_DAYS)

  // ── Nutrition: what was ACTUALLY eaten (the diary), not the plan — the coach
  //    must ground advice on real intake (food_log_entries). ──
  try {
    const diary = await fetchFoodLogRange(from, data.today)
    ctx.nutrition = diary.map(m => ({
      d: m.date, slot: m.meal_slot, t: m.title,
      kcal: m.calories ?? null, p: m.protein_g ?? null,
    }))
  } catch { /* optional */ }

  // ── The coach's own recent assessments (continuity across surfaces) ──
  try {
    const assessments = await fetchAssessments(3)
    ctx.past_assessments = assessments.map(a => ({ d: a.date, feeling: a.feeling, text: a.assessment.slice(0, 400) }))
  } catch { /* optional (pre-migration) */ }

  return JSON.stringify(ctx)
}
