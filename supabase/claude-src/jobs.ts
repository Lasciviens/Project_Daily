// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the job list
//
//  Every job the function can run, by name. A request names its job and this
//  fixed list answers; nothing a request sends can add a job or change one.
//  A new job is a new job-<name>.ts file and one line here.
// ─────────────────────────────────────────────────────────────────────────────

import type { JobDefinition } from './types.ts'
import { ITEM_FILL_JOB } from './job-item-fill.ts'
import { DIAGNOSE_JOB } from './job-diagnose.ts'

export const JOB_LIST: readonly JobDefinition[] = [ITEM_FILL_JOB, DIAGNOSE_JOB]

// A Map, not a plain object: a name like "constructor" or "__proto__" finds nothing in it.
const JOBS_BY_NAME: ReadonlyMap<string, JobDefinition> = new Map(JOB_LIST.map(job => [job.name, job]))

export function findJob(name: unknown): JobDefinition | null {
  return typeof name === 'string' ? JOBS_BY_NAME.get(name) ?? null : null
}
