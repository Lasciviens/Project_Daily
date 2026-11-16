// Checks the device copy of the app's last answers (src/shared/query/persist.ts, persistRules.ts): what may be
// kept, when a kept copy may be shown, and that sign-out removes it.
//   node scripts/verify-query-persist.cjs
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const R = require('../src/shared/query/persistRules.ts')

let n = 0
const check = (name, ok) => { assert.ok(ok, name); n++ }
const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const NOW = Date.UTC(2026, 10, 16, 9, 0, 0)
const DAY = 24 * 60 * 60_000
const q = (over) => ({ queryKey: ['tasks', 'day', '2026-11-16'], status: 'success', dataUpdatedAt: NOW - 60_000, gcTime: DAY, ...over })

// ── What goes into the copy ──────────────────────────────────────────────────
check('a successful read is kept', R.keepsQuery(q(), NOW))
check('a failed read is not', !R.keepsQuery(q({ status: 'error' }), NOW))
check('a read still loading is not', !R.keepsQuery(q({ status: 'pending', dataUpdatedAt: 0 }), NOW))
check('an answer with no read time is not', !R.keepsQuery(q({ dataUpdatedAt: 0 }), NOW))
check('an answer a week old is still kept', R.keepsQuery(q({ dataUpdatedAt: NOW - R.KEEP_MS }), NOW))
check('an answer older than a week is dropped', !R.keepsQuery(q({ dataUpdatedAt: NOW - R.KEEP_MS - 1 }), NOW))
check('an answer its hook wants gone at once (gcTime 0) is never kept', !R.keepsQuery(q({ gcTime: 0 }), NOW))
for (const root of ['geolocation', 'nearby-stops', 'icloud', 'audit-logs', 'error-logs', 'departures', 'trip', 'trip-via', 'stopSearch', 'stop-directions', 'news-article']) {
  check(`never kept: ${root}`, !R.keepsQuery(q({ queryKey: [root, 'x'] }), NOW))
}
check('a key that does not start with a name is not kept', !R.keepsQuery(q({ queryKey: [{ a: 1 }] }), NOW) && !R.keepsQuery(q({ queryKey: [] }), NOW))
check('health, tasks, shop and the diary are kept (the account\'s own pages)', ['health', 'tasks', 'shop', 'diary', 'schedule'].every(r => R.keepsQuery(q({ queryKey: [r] }), NOW)))

// The never-kept names are real query-key roots: a renamed key must not slip into the copy.
const keys = src('src/shared/query/keys.ts')
for (const root of R.NEVER_KEPT) check(`"${root}" is a query key root in keys.ts`, keys.includes(`['${root}'`))
check('the phone\'s position is asked once per session and never kept', /geolocation: \(\) => \['geolocation'\]/.test(keys))
check('every Apple Calendar key sits under "icloud" (its item-send read sends — it must run, never replay)',
  [...keys.matchAll(/\['icloud'/g)].length >= 4 && /itemSend: .*\['icloud', 'item-send'/.test(keys))

// ── When a kept copy may be shown ────────────────────────────────────────────
const ME = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002'
const copy = (over) => ({ build: 'b1', userId: ME, savedAt: NOW - 60_000, ...over })
const now = (over) => ({ build: 'b1', userId: ME, at: NOW, ...over })
check('this account, this build, within the week: shown', R.mayShowCopy(copy(), now()))
check('another account\'s copy is never shown', !R.mayShowCopy(copy({ userId: OTHER }), now()))
check('signed out: never shown', !R.mayShowCopy(copy(), now({ userId: null })))
check('another build\'s copy is never shown', !R.mayShowCopy(copy({ build: 'b0' }), now()))
check('a copy older than a week is never shown', !R.mayShowCopy(copy({ savedAt: NOW - R.KEEP_MS - 1 }), now()))
check('a copy from the future (a clock set back) is never shown', !R.mayShowCopy(copy({ savedAt: NOW + 1 }), now()))
check('a broken copy is never shown', !R.mayShowCopy(null, now()) && !R.mayShowCopy({}, now()) && !R.mayShowCopy({ build: 'b1', userId: 5, savedAt: NOW }, now()) && !R.mayShowCopy({ build: 'b1', userId: ME, savedAt: 'x' }, now()))

// ── The wiring ───────────────────────────────────────────────────────────────
const persist = src('src/shared/query/persist.ts')
check('a copy is shown only through mayShowCopy, and deleted otherwise',
  /if \(!mayShowCopy\(copy, \{ build: __BUILD_ID__, userId: forUser, at: Date\.now\(\) \}\)\) \{ await deleteCopy\(\); return \}/.test(persist))
check('the account is checked again after the read, before anything is put back',
  /if \(owner !== forUser \|\| storedSessionUserId\(\) !== forUser\) return\s+try \{\s+hydrate\(qc, copy\.state\)/.test(persist))
check('a start reads every kept answer again (they are marked out of date)',
  /qc\.invalidateQueries\(\{ refetchType: 'none', predicate: q => q\.state\.dataUpdatedAt <= savedAt \}\)/.test(persist))
check('nothing is written while signed out or for another account',
  /if \(!qc \|\| !userId \|\| userId !== owner\) return/.test(persist))
check('only answers go into the copy: no mutations, and each query through keepsQuery',
  /shouldDehydrateMutation: \(\) => false/.test(persist) && /shouldDehydrateQuery: q => !unclonable\.has\(q\.queryHash\) && keepsQuery\(/.test(persist))
check('forgetting drops the owner, the pending save, the memory and the device copy',
  /export function forgetKeptAnswers\(\): void \{\s+owner = null\s+firstUnsavedAt = 0\s+if \(saveTimer\) \{ clearTimeout\(saveTimer\); saveTimer = null \}\s+try \{ client\?\.clear\(\) \} catch \{[^}]*\}\s+if \(typeof indexedDB !== 'undefined'\) void deleteCopy\(\)/.test(persist))
check('another account signing in drops what was kept before it is shown or written',
  /export function confirmAnswersOwner\(userId: string\): void \{\s+if \(owner && owner !== userId\) forgetKeptAnswers\(\)\s+owner = userId/.test(persist))
check('the copy holds no session: persist.ts never reads the session\'s tokens', !/access_token|refresh_token|getSession/.test(persist))

const account = src('src/security/accountState.ts')
check('sign-out (clearAccountState) forgets the kept answers first',
  /export async function clearAccountState\(\): Promise<void> \{\s+\/\/[^\n]*\n\s+try \{ forgetKeptAnswers\(\) \}/.test(account))
const auth = src('src/shared/hooks/useAuth.ts')
check('the real session names the owner, and SIGNED_OUT elsewhere clears the account state',
  (auth.match(/if \(session\) confirmAnswersOwner\(session\.user\.id\)/g) || []).length === 2 && /if \(event === 'SIGNED_OUT'\) void clearAccountState\(\)/.test(auth))
const guard = src('src/security/sessionGuard.tsx')
check('the shell draws on the stored sign-in only while the session is read; no session still goes to login',
  /if \(loading && likelySignedIn\) return <>\{children\}<\/>/.test(guard) && /if \(!session\) return <Navigate to="\/login" replace \/>/.test(guard))
const stored = src('src/security/storedSession.ts')
check('the stored sign-in hint needs a user id and a refresh token, and hands out neither token',
  /typeof id === 'string' && id && typeof session\?\.refresh_token === 'string' \? id : null/.test(stored) && !/return .*(access_token|refresh_token)\b(?!')/.test(stored.replace(/typeof session\?\.refresh_token === 'string'/, '')))
check('each build has its own id', /define: \{ __BUILD_ID__: JSON\.stringify\(Date\.now\(\)\.toString\(36\)\) \}/.test(src('vite.config.ts')))
check('the service worker still caches no Supabase answers', !/supabase\.co/.test(src('vite.config.ts').replace(/\/\/[^\n]*/g, '')))
const providers = src('src/app/providers.tsx')
check('reads wait for the kept answers (IsRestoringProvider), and unused answers stay a day in memory',
  /<IsRestoringProvider value=\{restoring\}>/.test(providers) && /gcTime: STALE\.day/.test(providers) && /startQueryPersistence\(queryClient\)/.test(providers))

console.log(`${n} passed, 0 failed`)
