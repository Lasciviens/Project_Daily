'use strict'
// Database functions (POST /rest/v1/rpc/<name>) the pages call while they load.
// Each answer has the real function's shape, worked out from the made-up rows.
// A function missing here answers [] (postgrest.cjs) and HARNESS_LOG=1 names it.
// Writes made through an RPC (saving an item, ticking a repeat's day) are not
// simulated: add an answer here when a test needs one.

const RPCS = {
  // 156: the app's own run of the day's repeats. The made-up data already holds today's tasks.
  app_repeat_days_today: (args) => ({ missed: 0, created: 0, skipped: 0, failed: 0, today: args.p_today ?? null }),

  // 155: Settings' "Convert old items" preview — nothing old to convert.
  app_convert_preview: () => ({ futureStandaloneBlocks: 0, pastStandaloneBlocks: 0, plans: 0, tasksWithSlots: 0, autoClearedEpisodes: 0, examples: [] }),

  // 180: the owner's own task labels, most used first.
  app_task_labels: (args, store) => {
    const uses = new Map()
    for (const t of store.rows('tasks')) for (const l of t.labels || []) uses.set(l, (uses.get(l) || 0) + 1)
    return [...uses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, n]) => ({ label, uses: n }))
  },
}

module.exports = { RPCS }
