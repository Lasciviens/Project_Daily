// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the job list
//
//  Every job the function can run, by name. A request names its job and this
//  fixed list answers; nothing a request sends can add a job or change one.
//  A new job is a new job-<name>.ts file and one line here.
// ─────────────────────────────────────────────────────────────────────────────

import type { JobDefinition } from './types.ts'
import { ITEM_FILL_JOB } from './job-item-fill.ts'
import { RECIPE_FROM_LINK_JOB, RECIPE_FROM_TEXT_JOB, RECIPE_MACROS_JOB } from './job-recipes.ts'
import { QUICK_GUESS_JOB, QUICK_GUESS_OPTIONS_JOB } from './job-quick-guess.ts'
import { QUICK_GUESS_PHOTO_JOB, RECEIPT_READ_JOB } from './job-photo.ts'
import { DEV_REQUEST_DRAFT_JOB, ERROR_EXPLAIN_JOB } from './job-dev-drafts.ts'
import { AD_IMPROVE_JOB, PLACE_IDEAS_JOB, WORK_WEEK_JOB } from './job-text-features.ts'
import { SHOP_TIDY_JOB } from './job-shop-tidy.ts'
import { COACH_ASSESSMENT_JOB } from './job-coach.ts'
import { KOBO_ASK_JOB, PHONE_ASK_JOB } from './job-device.ts'
import { WEEKLY_REPORT_JOB } from './job-weekly-report.ts'
import { SUGGEST_WEEKLY_JOB } from './job-suggest-weekly.ts'
import { LEARN_EVAL_JOB } from './job-learn-eval.ts'
import { TEST_BENCH_JOB } from './job-test-bench.ts'
import { DIAGNOSE_JOB } from './job-diagnose.ts'
import { CHAT_JOB } from './chat-rules.ts'

export const JOB_LIST: readonly JobDefinition[] = [
  ITEM_FILL_JOB, RECIPE_FROM_TEXT_JOB, RECIPE_FROM_LINK_JOB, RECIPE_MACROS_JOB, QUICK_GUESS_JOB, QUICK_GUESS_OPTIONS_JOB,
  // The AI features the owner picked (22.11.2026): photos, Dev Requests, Work, Shop, Wishes.
  QUICK_GUESS_PHOTO_JOB, RECEIPT_READ_JOB, DEV_REQUEST_DRAFT_JOB, ERROR_EXPLAIN_JOB, WORK_WEEK_JOB, AD_IMPROVE_JOB, PLACE_IDEAS_JOB, SHOP_TIDY_JOB,
  COACH_ASSESSMENT_JOB, KOBO_ASK_JOB, PHONE_ASK_JOB, WEEKLY_REPORT_JOB, SUGGEST_WEEKLY_JOB, LEARN_EVAL_JOB, TEST_BENCH_JOB, DIAGNOSE_JOB, CHAT_JOB,
]

// A Map, not a plain object: a name like "constructor" or "__proto__" finds nothing in it.
const JOBS_BY_NAME: ReadonlyMap<string, JobDefinition> = new Map(JOB_LIST.map(job => [job.name, job]))

export function findJob(name: unknown): JobDefinition | null {
  return typeof name === 'string' ? JOBS_BY_NAME.get(name) ?? null : null
}
