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
import { ProjectsPage } from '../features/projects/pages/ProjectsPage'
import { WishesPage } from '../features/wishes/pages/WishesPage'
import { DeveloperPage } from '../features/developer/pages/DeveloperPage'

export function Router() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

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
          <Route path="/projects"  element={<ProjectsPage />} />
          <Route path="/wishes"    element={<WishesPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
