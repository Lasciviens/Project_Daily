import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionGuard } from '../security/sessionGuard'
import { Layout } from './layout'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { DailyPage } from '../features/daily/pages/DailyPage'
import { MediaPage } from '../features/media/pages/MediaPage'

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
          <Route index element={<Navigate to="/daily" replace />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/media"  element={<MediaPage />} />
          <Route path="/work"   element={<div className="p-6 text-ink-500">Work — coming in Phase 4</div>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
