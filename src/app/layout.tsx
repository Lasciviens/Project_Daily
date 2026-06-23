import { Outlet, NavLink } from 'react-router-dom'
import { format } from 'date-fns'
import { ToDoDrawer } from '../features/todo/components/ToDoDrawer'
import { AIPanel } from '../features/ai/components/AIPanel'
import { CommandBar } from '../shared/components/CommandBar'
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
      <CommandBar />
      <Toaster />
    </div>
  )
}

function Nav() {
  const { isToDoOpen, toggleToDo, isAIOpen, toggleAI, openCommandBar } = useUIStore()

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2.5 min-h-[44px] inline-flex items-center text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
      isActive
        ? 'bg-accent-500 text-white'
        : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-ink-200">
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-7 h-7 bg-accent-500 rounded-lg flex items-center justify-center text-white text-sm font-bold">
            L
          </div>
          <span className="font-semibold text-ink-900 text-sm hidden sm:block">Lasci's Board</span>
        </div>

        {/* Nav links — scrollable on mobile so they never wrap or overflow */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
          <NavLink to="/home"      className={linkClass}>Home</NavLink>
          <NavLink to="/daily"     className={linkClass}>Daily</NavLink>
          <NavLink to="/media"     className={linkClass}>Media</NavLink>
          <NavLink to="/work"      className={linkClass}>Work</NavLink>
          <NavLink to="/training"  className={linkClass}>Training</NavLink>
          <NavLink to="/games"     className={linkClass}>Games</NavLink>
          <NavLink to="/projects"  className={linkClass}>Projects</NavLink>
          <NavLink to="/football"  className={linkClass}>Football</NavLink>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Today's date */}
          <span className="text-xs text-ink-400 hidden md:block mr-2">
            {format(new Date(), 'EEEE, MMM d')}
          </span>

          {/* ⌘K command bar trigger */}
          <button
            onClick={openCommandBar}
            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors duration-150 hidden md:flex items-center gap-1.5 border border-ink-200"
          >
            <span>Search</span>
            <kbd className="text-[10px] bg-ink-100 px-1 py-0.5 rounded">⌘K</kbd>
          </button>

          <button
            onClick={toggleAI}
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 hidden sm:flex items-center ${
              isAIOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            ✦ Ask AI
          </button>

          <button
            onClick={toggleToDo}
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 flex items-center flex-shrink-0 ${
              isToDoOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            <span className="sm:hidden">☑</span>
            <span className="hidden sm:inline">☑ To-Do</span>
          </button>

          <SettingsMenu />
        </div>
      </div>
    </header>
  )
}
