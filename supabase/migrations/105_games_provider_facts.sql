-- 105 — games.provider_kind and games.first_played_at (PlayStation facts)
--
-- Two facts Sony's played-games list already carries on every row and the
-- import threw away:
--
--   * provider_kind — Sony's `category` ("ps4_game", "ps5_native_game",
--     "pspc_game", or an app/media value). Without it a PlayStation app
--     (a streaming or video app you launched) can never be told apart from a
--     game: the importer promotes it to Playing after 30 minutes, and it then
--     inflates play time, Most played and Playing now. The Games page hides a
--     row whose kind says "not a game" while its status is still undecided —
--     the rule Steam rows already follow through steam_apps.type.
--   * first_played_at — Sony's firstPlayedDateTime. The only honest "when did
--     I start this" PlayStation reports; lets Analytics say how long a game
--     sat between first launch and completion.
--
-- Written only by the Steam/PlayStation import (the browser's
-- importProviderGames), never by a user edit. Plain nullable columns: no
-- CHECK on provider_kind, because Sony's category vocabulary is not
-- documented and a new value must never make an import fail.
--
-- Updates NO existing row: both columns fill on the next PlayStation import
-- ("Refresh playtime"). Pre-migration safe: the list read drops a missing
-- column and retries, and the import retries without both columns.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS provider_kind text;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS first_played_at timestamptz;

COMMENT ON COLUMN public.games.provider_kind IS
  'The provider''s own classification of the title (PlayStation: category such as ps5_native_game). Import-written.';
COMMENT ON COLUMN public.games.first_played_at IS
  'The provider''s first-played timestamp (PlayStation firstPlayedDateTime). Import-written.';
