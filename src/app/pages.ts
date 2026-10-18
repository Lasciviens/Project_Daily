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
export const WorkPage     = lazyPage('work-page',      () => import('../features/work/pages/WorkPage').then(m => m.WorkPage))
export const TrainingPage = lazyPage('training-page',  () => import('../features/training/pages/TrainingPage').then(m => m.TrainingPage))
export const HealthPage   = lazyPage('health-page',    () => import('../features/health/pages/HealthPage').then(m => m.HealthPage))
export const ProjectsPage = lazyPage('projects-page',  () => import('../features/projects/pages/ProjectsPage').then(m => m.ProjectsPage))
export const ProjectPage = lazyPage('project-page',  () => import('../features/projects/pages/ProjectPage').then(m => m.ProjectPage))
export const WishesPage   = lazyPage('wishes-page',    () => import('../features/wishes/pages/WishesPage').then(m => m.WishesPage))
export const BooksPage    = lazyPage('books-page',     () => import('../features/books/pages/BooksPage').then(m => m.BooksPage))
export const DeveloperPage = lazyPage('developer-page', () => import('../features/developer/pages/DeveloperPage').then(m => m.DeveloperPage))
export const SettingsPage = lazyPage('settings-page',  () => import('../features/settings/pages/SettingsPage').then(m => m.SettingsPage))

// Most used first: the tab-bar pages, then the rest.
const PRELOAD_ORDER = [
  HomePage, DailyPage, RecipesPage, MediaPage, TrainingPage, HealthPage, ShopPage,
  WishesPage, BooksPage, WorkPage, ProjectsPage, SettingsPage, DeveloperPage,
]

/** Loads every page's code, one after another, without competing with what is on screen. */
export async function preloadPages() {
  for (const page of PRELOAD_ORDER) await page.preload()
}
