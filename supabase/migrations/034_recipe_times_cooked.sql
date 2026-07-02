-- Lightweight "how often do I actually make this" signal — an organic
-- favorites proxy without a separate favorites table.
alter table recipes add column if not exists times_cooked integer not null default 0;
