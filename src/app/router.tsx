import { lazy, Suspense, type ComponentType } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionGuard } from '../security/sessionGuard'
import { Layout } from './layout'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage'
import { HomePage } from '../features/home/pages/HomePage'
import { PersonalLayout } from '../features/personal/components/PersonalLayout'
import { DailyPage } from '../features/daily/pages/DailyPage'
import { ShopPage } from '../features/shop/pages/ShopPage'
import { RecipesPage } from '../features/recipes/pages/RecipesPage'
import { MediaPage } from '../features/media/pages/MediaPage'
import { WorkPage } from '../features/work/pages/WorkPage'
import { TrainingPage } from '../features/training/pages/TrainingPage'
import { GamesPage } from '../features/games/pages/GamesPage'
import { GamesLibraryDemoPage } from '../features/games/pages/GamesLibraryDemoPage'
import { GamesCoverDemoPage } from '../features/games/pages/GamesCoverDemoPage'
import { ProjectsPage } from '../features/projects/pages/ProjectsPage'
import { WishesPage } from '../features/wishes/pages/WishesPage'
import { DeveloperPage } from '../features/developer/pages/DeveloperPage'
import { logError } from '../shared/utils/logError'

// ── Test-Game, loaded on demand ─────────────────────────────────────────────
// A standalone experiment reached from one link, so its ~100 kB of JS and its
// stylesheet stay out of every other route's first download.
//
// A lazy chunk can fail to load after a deploy: skipWaiting + clientsClaim
// (vite.config.ts) swap the service worker under an open tab, whose old entry
// bundle still asks for a chunk hash the server no longer has. The first
// failure reloads the page once (fresh index.html, fresh hashes); a
// sessionStorage flag stops that from ever looping, and a second failure shows
// a plain reload prompt instead of a blank page.

const CHUNK_RELOAD_FLAG = 'lasci.chunk-reload'

function ChunkLoadFailed() {
  return (
    <div role="alert" className="grid min-h-[100dvh] place-items-center bg-canvas p-6 text-center">
      <div className="max-w-sm">
        <p className="text-base font-semibold text-ink-900">This page couldn't be loaded</p>
        <p className="mt-1.5 text-sm text-ink-600">Check your connection, then reload to get the latest version of the app.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary mt-4 min-h-[44px] px-5"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

/** Records the one reload we allow; false when it was already spent — or when
 *  storage is blocked, since a reload we cannot record could loop forever. */
function markReloadAttempt(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') return false
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
    return true
  } catch {
    return false
  }
}

function lazyWithReload<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async (): Promise<{ default: ComponentType<P> }> => {
    try {
      const component = await load()
      try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG) } catch { /* storage blocked: nothing to clear */ }
      return { default: component }
    } catch (err) {
      // Logged either way: a stale chunk after a deploy is expected, but an
      // exception thrown while the page module evaluates lands here too, and
      // without a record it would only ever look like "check your connection".
      void logError((err as Error)?.message ?? 'Lazy route failed to load', { action: 'lazy_route_load' })
      if (markReloadAttempt()) {
        window.location.reload()
        return new Promise(() => {}) // keep the fallback up until the reload lands
      }
      return { default: ChunkLoadFailed }
    }
  })
}

const TestGamePage = lazyWithReload(() =>
  import('../features/games/test-game/TestGamePage').then(m => m.TestGamePage))

export function Router() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Test-Game: the Games page rebuilt on the new design. Outside
            <Layout> on purpose — it draws its own sidebar, top bar and phone
            tab bar, exactly as the design does — but behind the same guard. */}
        <Route
          path="/test-game"
          element={
            <SessionGuard>
              <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh] bg-canvas" />}>
                <TestGamePage />
              </Suspense>
            </SessionGuard>
          }
        />

        <Route
          element={
            <SessionGuard>
              <Layout />
            </SessionGuard>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/home"  element={<HomePage />} />

          {/* Personal nav group — shared tab bar (Daily/Shop/Recipes) via PersonalLayout */}
          <Route element={<PersonalLayout />}>
            <Route path="/daily"    element={<DailyPage />} />
            <Route path="/shop"     element={<ShopPage />} />
            <Route path="/recipes"  element={<RecipesPage />} />
          </Route>

          <Route path="/media" element={<MediaPage />} />
          <Route path="/work"     element={<WorkPage />} />
          <Route path="/training"  element={<TrainingPage />} />
          <Route path="/games"     element={<GamesPage />} />
          <Route path="/games-demo" element={<GamesLibraryDemoPage />} />
          <Route path="/games-cover-demo" element={<GamesCoverDemoPage />} />
          <Route path="/projects"  element={<ProjectsPage />} />
          <Route path="/wishes"    element={<WishesPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
