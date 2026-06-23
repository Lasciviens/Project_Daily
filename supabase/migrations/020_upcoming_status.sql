ALTER TABLE user_movie_entries DROP CONSTRAINT IF EXISTS user_movie_entries_status_check;
ALTER TABLE user_movie_entries ADD CONSTRAINT user_movie_entries_status_check
  CHECK (status IN ('watching','wishlist','completed','dropped','upcoming'));
