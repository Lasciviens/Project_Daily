import { Outlet, NavLink } from 'react-router-dom'
import { format } from 'date-fns'
import { ToDoDrawer } from '../features/todo/components/ToDoDrawer'
import { AIPanel } from '../features/ai/components/AIPanel'
import { SettingsMenu } from '../shared/components/SettingsMenu'
import { Toaster } from '../shared/components/Toaster'
import { useUIStore } from './store'

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-cream-100">
      <Nav />
      <main className="flex-1">
        <Outlet />
      </main>
      <ToDoDrawer />
      <AIPanel />
      <Toaster />
    </div>
  )
}

function Nav() {
  const { isToDoOpen, toggleToDo, isAIOpen, toggleAI } = useUIStore()

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 ${
      isActive
        ? 'bg-accent-500 text-white'
        : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-ink-200">
      <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent-500 rounded-lg flex items-center justify-center text-white text-sm font-bold">
            L
          </div>
          <span className="font-semibold text-ink-900 text-sm hidden sm:block">Lasci's Board</span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          <NavLink to="/home"  className={linkClass}>Home</NavLink>
          <NavLink to="/daily" className={linkClass}>Daily</NavLink>
          <NavLink to="/media" className={linkClass}>Media</NavLink>
          <NavLink to="/work"     className={linkClass}>Work</NavLink>
          <NavLink to="/training" className={linkClass}>Training</NavLink>
          <NavLink to="/games"    className={linkClass}>Games</NavLink>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          {/* Today's date */}
          <span className="text-xs text-ink-400 hidden md:block mr-2">
            {format(new Date(), 'EEEE, MMM d')}
          </span>

          <button
            onClick={toggleAI}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 hidden sm:block ${
              isAIOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            ✦ Ask AI
          </button>

          <button
            onClick={toggleToDo}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
              isToDoOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            ☑ To-Do
          </button>

          <SettingsMenu />
        </div>
      </div>
    </header>
  )
}
