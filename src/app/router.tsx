import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionGuard } from '../security/sessionGuard'
import { Layout } from './layout'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { HomePage } from '../features/home/pages/HomePage'
import { DailyPage } from '../features/daily/pages/DailyPage'
import { ShopPage } from '../features/shop/pages/ShopPage'
import { RecipesPage } from '../features/recipes/pages/RecipesPage'
import { MediaPage } from '../features/media/pages/MediaPage'
import { WorkPage } from '../features/work/pages/WorkPage'
import { TrainingPage } from '../features/training/pages/TrainingPage'
import { GamesPage } from '../features/games/pages/GamesPage'
import { ProjectsPage } from '../features/projects/pages/ProjectsPage'
import { DeveloperPage } from '../features/developer/pages/DeveloperPage'

export function Router() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <SessionGuard>
              <Layout />
            </SessionGuard>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/home"  element={<HomePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/shop"    element={<ShopPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/work"     element={<WorkPage />} />
          <Route path="/training"  element={<TrainingPage />} />
          <Route path="/games"     element={<GamesPage />} />
          <Route path="/projects"  element={<ProjectsPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
