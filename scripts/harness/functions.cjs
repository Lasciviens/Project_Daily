'use strict'
// Edge functions (POST /functions/v1/<name>) the pages call while they load.
// Each answer is what the real function says for an owner who has connected
// nothing outside the app (no Google, Trakt, Steam, PlayStation, iCloud …) —
// read from supabase/functions/<name>/index.ts. The harness never pretends an
// outside service answered. A function missing here answers {} and
// HARNESS_LOG=1 names it.

const reply = (status, body) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })

const FUNCTIONS = {
  // No Google connection: 404 is the function's own "not connected" (the page offers Connect).
  'calendar-token': () => reply(404, { error: 'not_connected' }),

  'trakt-api': ({ body, log }) => {
    if (body?.action === 'status') {
      return {
        connected: false, username: null, connectedAt: null, lastSyncAt: null, lastError: null, needsReconnect: false,
        lastResult: null, imported: false, pending: 0, syncing: false, historyLinked: false,
      }
    }
    log(`function trakt-api: action ${body?.action ?? '(none)'} answered "not_connected"`)
    return { error: 'not_connected' }
  },

  // No STEAM_API_KEY / STEAM_ID64 on the server.
  'steam-api': () => ({ error: 'not_configured' }),

  'psn-api': ({ body }) => (body?.action === 'status'
    ? { connected: false, connectedAt: null, expiresAt: null, npssoExpiresAt: null }
    : reply(400, { error: 'not_connected' })),

  'igdb-api': ({ body }) => (body?.action === 'status' ? { configured: false } : { error: 'not_configured' }),

  'icloud-calendar': ({ body }) => (body?.action === 'status'
    ? { connected: false, readBack: {}, notSent: null }
    : reply(400, { error: 'Apple Calendar is not connected' })),

  // The lookup (Nasjonalbiblioteket, Open Library) is outside: nothing found.
  'book-meta': () => ({ updated: [], source: null }),
}

module.exports = { FUNCTIONS, reply }
