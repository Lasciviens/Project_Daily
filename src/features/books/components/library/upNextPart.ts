import { lazyPart } from '../../../../shared/utils/lazyPage'

// Up next's drag (@dnd-kit) is its own chunk: the rows show without it until
// it lands (UpNext), and BooksPage loads it in idle time once the page shows.
export const UpNextList = lazyPart('books-up-next', () => import('./UpNextList').then(m => m.UpNextList))
