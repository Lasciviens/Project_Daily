-- Add is_focused column for persistent multi-focus in Work page
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_focused BOOLEAN DEFAULT false;
