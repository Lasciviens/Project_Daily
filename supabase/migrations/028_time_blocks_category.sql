-- Migration 028: add category column to time_blocks
ALTER TABLE public.time_blocks
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IN ('daily','training','media','games','work','projects','other'))
    DEFAULT 'other';
