import { Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionGuard } from '../security/sessionGuard'
import { ErrorBoundary } from '../shared/components/ErrorBoundary'
import { AppShell } from './shell/AppShell'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage'
import { HomePage } from '../features/home/pages/HomePage'
import { DailyPage } from '../features/daily/pages/DailyPage'
import { ShopPage } from '../features/shop/pages/ShopPage'
import { RecipesPage } from '../features/recipes/pages/RecipesPage'
import { MediaPage } from '../features/media/pages/MediaPage'
import { WorkPage } from '../features/work/pages/WorkPage'
import { TrainingPage } from '../features/training/pages/TrainingPage'
import { ProjectsPage } from '../features/projects/pages/ProjectsPage'
import { WishesPage } from '../features/wishes/pages/WishesPage'
import { DeveloperPage } from '../features/developer/pages/DeveloperPage'
import { lazyWithReload } from '../shared/utils/lazyWithReload'

// ── Games, loaded on demand ─────────────────────────────────────────────────
// A full-screen page outside the app shell, so its JS and its stylesheet stay
// out of every other route's first download. lazyWithReload survives a chunk
// that disappeared in a deploy (see src/shared/utils/lazyWithReload.ts).

const TestGamePage = lazyWithReload('games-page', () =>
  import('../features/games/test-game/TestGamePage').then(m => m.TestGamePage))

export function Router() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Games: the "Game Library" design. Outside <AppShell> on purpose — it
            draws its own sidebar, top bar and phone tab bar — but behind the
            same guard. The old page's addresses (/games-legacy, the two demo
            pages, /test-game from its time under test) redirect here. */}
        <Route
          path="/games"
          element={
            <SessionGuard>
              {/* The page renders free-form provider and scraped records; a
                  render-time throw shows a Try-again card, not a blank screen. */}
              <ErrorBoundary label="Games" action="games_page">
                <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh] bg-canvas" />}>
                  <TestGamePage />
                </Suspense>
              </ErrorBoundary>
            </SessionGuard>
          }
        />
        <Route path="/test-game" element={<Navigate to="/games" replace />} />
        <Route path="/games-legacy" element={<Navigate to="/games" replace />} />
        <Route path="/games-demo" element={<Navigate to="/games" replace />} />
        <Route path="/games-cover-demo" element={<Navigate to="/games" replace />} />

        <Route
          element={
            <SessionGuard>
              <AppShell />
            </SessionGuard>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/home"  element={<HomePage />} />

          <Route path="/daily"    element={<DailyPage />} />
          <Route path="/shop"     element={<ShopPage />} />
          <Route path="/recipes"  element={<RecipesPage />} />

          <Route path="/media" element={<MediaPage />} />
          <Route path="/work"     element={<WorkPage />} />
          <Route path="/training"  element={<TrainingPage />} />
          <Route path="/projects"  element={<ProjectsPage />} />
          <Route path="/wishes"    element={<WishesPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
