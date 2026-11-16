import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import { storedSessionUserId } from '../../security/storedSession'
import { keepsQuery, mayShowCopy, type KeptCopyFacts } from './persistRules'

// The device copy of the app's last answers (owner, 16.11.2026: "the first time app loads takes too much time").
// Before, every start began empty: each page drew its loading copies and waited for a hundred reads. Now the
// answers the app last showed are kept in this browser (IndexedDB) and put back before the first page draws, so
// it opens with what it showed last time — and every one of them is read again at once, as a start always did
// (they are marked out of date), so what is on screen is corrected within the same moment the old start needed.
//
// What keeps it safe (persistRules.ts, verify-query-persist):
// - one copy, for one account: shown only to the account whose session this browser holds, written by this
//   build, within a week; anything else is deleted unread;
// - sign-out — here or elsewhere — deletes it and empties the memory it came from (accountState.ts);
// - nothing is written while signed out, and never an answer on the never-kept list (the phone's position,
//   Apple Calendar's queue, logs, live departures);
// - it holds answers only: no session, no token, no key (those never were in the query cache).

const DB_NAME = 'lasci-board'
const STORE = 'kept'
const KEY = 'answers'
/** The start never waits longer than this for the copy; a later one is still put in behind what has loaded. */
const RESTORE_WAIT_MS = 800
/** A save follows the last change by this long … */
const SAVE_QUIET_MS = 2000
/** … and never trails the first unsaved change by more than this. */
const SAVE_LATEST_MS = 10_000

interface KeptCopy extends KeptCopyFacts { state: DehydratedState }

let client: QueryClient | null = null
/** The account the answers in memory belong to. */
let owner: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let firstUnsavedAt = 0
/** Answers IndexedDB couldn't copy (a function or a class inside): left out from then on. */
const unclonable = new Set<string>()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? req.error)
      tx.onabort = () => reject(tx.error ?? req.error)
    })
  } finally {
    db.close()
  }
}

const readCopy = () => withStore<KeptCopy | undefined>('readonly', s => s.get(KEY) as IDBRequest<KeptCopy | undefined>)
const deleteCopy = () => withStore('readwrite', s => s.delete(KEY)).then(() => undefined, () => undefined)

async function restore(qc: QueryClient, forUser: string): Promise<void> {
  let copy: KeptCopy | undefined
  try { copy = await readCopy() } catch { return }
  if (!copy) return
  if (!mayShowCopy(copy, { build: __BUILD_ID__, userId: forUser, at: Date.now() })) { await deleteCopy(); return }
  // Signed out, or another account, while the copy was being read.
  if (owner !== forUser || storedSessionUserId() !== forUser) return
  try {
    hydrate(qc, copy.state)
  } catch {
    await deleteCopy()
    return
  }
  // A start reads everything again, as it always did: each kept answer shows until its own read lands.
  const savedAt = copy.savedAt
  void qc.invalidateQueries({ refetchType: 'none', predicate: q => q.state.dataUpdatedAt <= savedAt })
}

function keptState(qc: QueryClient, now: number): DehydratedState {
  return dehydrate(qc, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: q => !unclonable.has(q.queryHash) && keepsQuery({
      queryKey: q.queryKey, status: q.state.status, dataUpdatedAt: q.state.dataUpdatedAt, gcTime: q.gcTime,
    }, now),
  })
}

async function save(): Promise<void> {
  firstUnsavedAt = 0
  const qc = client
  const userId = storedSessionUserId()
  // Signed out, or the answers in memory are another account's: nothing is written.
  if (!qc || !userId || userId !== owner) return
  const now = Date.now()
  const write = (state: DehydratedState) => withStore('readwrite', s => s.put({ build: __BUILD_ID__, userId, savedAt: now, state } satisfies KeptCopy, KEY))
  const state = keptState(qc, now)
  try {
    await write(state)
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'DataCloneError') return
    // Find what can't be copied, leave it out from now on, and write the rest.
    for (const q of state.queries) {
      try { structuredClone(q.state.data) } catch { unclonable.add(q.queryHash) }
    }
    if (owner !== userId) return
    try { await write(keptState(qc, now)) } catch { /* no copy this time */ }
  }
}

function scheduleSave() {
  const now = Date.now()
  if (!firstUnsavedAt) firstUnsavedAt = now
  if (saveTimer) clearTimeout(saveTimer)
  const wait = Math.max(0, Math.min(SAVE_QUIET_MS, firstUnsavedAt + SAVE_LATEST_MS - now))
  saveTimer = setTimeout(() => { saveTimer = null; void save() }, wait)
}

function saveNow() {
  if (!firstUnsavedAt) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  void save()
}

/**
 * Starts keeping the app's answers on this device and puts the last copy back. Resolves when the copy is in
 * (or there is none, or it took too long): the app holds its reads until then, so a page draws with its kept
 * answers instead of asking first. Called once, before the app renders.
 */
export function startQueryPersistence(qc: QueryClient): Promise<void> {
  client = qc
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  owner = storedSessionUserId()
  const restored = (owner ? restore(qc, owner) : deleteCopy()).catch(() => undefined)
  void restored.then(() => {
    qc.getQueryCache().subscribe(event => {
      if (event.type === 'removed' || (event.type === 'updated' && event.action.type === 'success')) scheduleSave()
    })
    // The app going to the background is the last sure moment: write what waits.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow() })
    window.addEventListener('pagehide', saveNow)
  })
  return Promise.race([restored, new Promise<void>(resolve => setTimeout(resolve, RESTORE_WAIT_MS))])
}

/**
 * The account now signed in, from the real session (useAuth). Answers kept for another account are dropped —
 * from memory and from the device — before anything of theirs can be shown or written under the new one.
 */
export function confirmAnswersOwner(userId: string): void {
  if (owner && owner !== userId) forgetKeptAnswers()
  owner = userId
}

/** Sign-out, here or elsewhere (accountState.ts): the device copy goes, and so do the answers in memory. */
export function forgetKeptAnswers(): void {
  owner = null
  firstUnsavedAt = 0
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try { client?.clear() } catch { /* */ }
  if (typeof indexedDB !== 'undefined') void deleteCopy()
}
