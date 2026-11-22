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
import { COACH_ASSESSMENT_JOB } from './job-coach.ts'
import { KOBO_ASK_JOB, PHONE_ASK_JOB, PHONE_BRIEF_JOB } from './job-device.ts'
import { TEST_BENCH_JOB } from './job-test-bench.ts'
import { DIAGNOSE_JOB } from './job-diagnose.ts'

export const JOB_LIST: readonly JobDefinition[] = [
  ITEM_FILL_JOB, RECIPE_FROM_TEXT_JOB, RECIPE_FROM_LINK_JOB, RECIPE_MACROS_JOB, QUICK_GUESS_JOB, QUICK_GUESS_OPTIONS_JOB,
  COACH_ASSESSMENT_JOB, KOBO_ASK_JOB, PHONE_BRIEF_JOB, PHONE_ASK_JOB, TEST_BENCH_JOB, DIAGNOSE_JOB,
]

// A Map, not a plain object: a name like "constructor" or "__proto__" finds nothing in it.
const JOBS_BY_NAME: ReadonlyMap<string, JobDefinition> = new Map(JOB_LIST.map(job => [job.name, job]))

export function findJob(name: unknown): JobDefinition | null {
  return typeof name === 'string' ? JOBS_BY_NAME.get(name) ?? null : null
}
