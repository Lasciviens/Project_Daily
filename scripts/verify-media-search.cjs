// Verifies src/features/media/searchFilters.ts (sucrase, no test framework).
require('sucrase/register')
const { applySearchFilters, searchFilterCount, NO_SEARCH_FILTERS } = require('../src/features/media/searchFilters.ts')
let n = 0
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', m, a, b); process.exit(1) } n++ }
const hits = [
  { id: 1, date: '2010-05-01', rating: 7.5, votes: 900, genres: [18] },
  { id: 2, date: '2022-01-01', rating: 8.2, votes: 10, genres: [28] },
  { id: 3, date: null, rating: 0, votes: 0, genres: [] },
  { id: 4, date: '1999-09-09', rating: 6.1, votes: 300, genres: [28, 18] },
]
const none = () => false
const ids = r => r.map(h => h.id)
eq(ids(applySearchFilters(hits, NO_SEARCH_FILTERS, none)), [1, 2, 3, 4], 'no filters keep TMDB order')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, genre: 18 }, none)), [1, 4], 'genre')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, fromYear: 2000 }, none)), [1, 2], 'from year drops undated')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, minRating: 7 }, none)), [1], 'score needs enough votes')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, notInLibrary: true }, id => id === 1)), [2, 3, 4], 'not in library')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, sort: 'newest' }, none)), [2, 1, 4, 3], 'newest, undated last')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, sort: 'oldest' }, none)), [4, 1, 2, 3], 'oldest, undated last')
eq(ids(applySearchFilters(hits, { ...NO_SEARCH_FILTERS, sort: 'rating' }, none)), [2, 1, 4, 3], 'rating')
eq(searchFilterCount({ ...NO_SEARCH_FILTERS, sort: 'newest' }), 0, 'sort is not a filter')
eq(searchFilterCount({ genre: 1, fromYear: 2000, minRating: 7, notInLibrary: true, sort: 'relevance' }), 4, 'count')
console.log(`verify-media-search: ${n} assertions passed`)
