-- Optional profile text; existing authentication and RLS remain unchanged.
-- Apply manually after reviewing this migration.
alter table public.profiles
  add column if not exists bio text not null default '' check (char_length(bio) <= 300);
