import { lazyPage } from '../shared/utils/lazyPage'

// Every signed-in page loads on demand, so the first download holds only the
// shell and the page you opened (it was one 2.7 MB file with every page in
// it). The rest load in idle time after start (preloadPages, AppShell), so
// moving between pages stays instant. Games has its own lazy entry in the
// router (its stylesheet stays out until it is opened).

export const HomePage     = lazyPage('home-page',      () => import('../features/home/pages/HomePage').then(m => m.HomePage))
export const DailyPage    = lazyPage('daily-page',     () => import('../features/daily/pages/DailyPage').then(m => m.DailyPage))
export const ShopPage     = lazyPage('shop-page',      () => import('../features/shop/pages/ShopPage').then(m => m.ShopPage))
export const RecipesPage  = lazyPage('recipes-page',   () => import('../features/recipes/pages/RecipesPage').then(m => m.RecipesPage))
export const MediaPage    = lazyPage('media-page',     () => import('../features/media/pages/MediaPage').then(m => m.MediaPage))
export const FootballPage = lazyPage('football-page',  () => import('../features/football/pages/FootballPage').then(m => m.FootballPage))
export const WorkPage     = lazyPage('work-page',      () => import('../features/work/pages/WorkPage').then(m => m.WorkPage))
export const TrainingPage = lazyPage('training-page',  () => import('../features/training/pages/TrainingPage').then(m => m.TrainingPage))
export const HealthPage   = lazyPage('health-page',    () => import('../features/health/pages/HealthPage').then(m => m.HealthPage))
export const ProjectsPage = lazyPage('projects-page',  () => import('../features/projects/pages/ProjectsPage').then(m => m.ProjectsPage))
export const ProjectPage  = lazyPage('project-page',   () => import('../features/projects/pages/ProjectPage').then(m => m.ProjectPage))
export const WishesPage   = lazyPage('wishes-page',    () => import('../features/wishes/pages/WishesPage').then(m => m.WishesPage))
export const BooksPage    = lazyPage('books-page',     () => import('../features/books/pages/BooksPage').then(m => m.BooksPage))
export const DeveloperPage = lazyPage('developer-page', () => import('../features/developer/pages/DeveloperPage').then(m => m.DeveloperPage))
export const NotificationsPage = lazyPage('notifications-page', () => import('../features/notifications/pages/NotificationsPage').then(m => m.NotificationsPage))
export const SettingsPage = lazyPage('settings-page',  () => import('../features/settings/pages/SettingsPage').then(m => m.SettingsPage))

// Most used first: the tab-bar pages, then the rest.
const PRELOAD_ORDER = [
  HomePage, DailyPage, RecipesPage, MediaPage, TrainingPage, HealthPage, ShopPage,
  WishesPage, BooksPage, FootballPage, WorkPage, ProjectsPage, ProjectPage, SettingsPage, NotificationsPage, DeveloperPage,
]

const BY_PATH: Record<string, { preload: () => Promise<void> }> = {
  '': HomePage, home: HomePage, daily: DailyPage, shop: ShopPage, recipes: RecipesPage, media: MediaPage,
  football: FootballPage, work: WorkPage, training: TrainingPage, health: HealthPage, projects: ProjectsPage,
  wishes: WishesPage, books: BooksPage, developer: DeveloperPage, settings: SettingsPage, notifications: NotificationsPage,
}

/**
 * Starts loading the code of the page in the address, at the very start — beside the shell's own code, not
 * after the shell has drawn (it used to be asked for only then: one more round trip before the page's first
 * read). `hash` is location.hash ("#/daily?date=2026-11-24").
 */
export function preloadOpenedPage(hash: string): void {
  const first = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  void BY_PATH[first]?.preload()
}

/** Loads every page's code, one after another, without competing with what is on screen. */
export async function preloadPages() {
  for (const page of PRELOAD_ORDER) await page.preload()
}
