-- Apply after 001_init.sql in the Supabase SQL Editor. Existing rows are preserved.
begin;

alter table public.posts add column if not exists activity_at timestamptz;

-- Existing posts keep their original expiration and start at their publication time.
update public.posts
set activity_at = coalesce(published_at, created_at)
where activity_at is null and status = 'PUBLISHED';

alter table public.comments add column if not exists client_request_id text;
create unique index if not exists comments_request_idx
  on public.comments(author_id, client_request_id);
create index if not exists posts_activity_idx
  on public.posts(status, activity_at, expires_at);

-- Apply all filters before pagination so matching nearby activities are not skipped.
create or replace function public.nearby_posts_filtered(
  p_lat double precision, p_lon double precision,
  p_radius_miles double precision default 10,
  p_limit int default 20, p_offset int default 0,
  p_category text default 'All', p_search text default '', p_time text default 'now'
)
returns setof public.posts
language sql stable security invoker
as $$
  select p.* from public.posts p
  where p.status = 'PUBLISHED'
    and p.expires_at > now()
    and (
      (p_time = 'now' and coalesce(p.activity_at, p.published_at, p.created_at) <= now())
      or (p_time = 'upcoming' and p.activity_at > now())
      or p_time = 'all'
    )
    and (coalesce(p_category, 'All') = 'All' or p_category = '' or p.category = p_category)
    and (coalesce(trim(p_search), '') = '' or
      strpos(lower(concat_ws(' ', p.title, p.description, p.place_name)), lower(trim(p_search))) > 0)
    and (3958.7613 * acos(least(1.0, greatest(-1.0,
      sin(radians(p_lat)) * sin(radians(p.latitude)) +
      cos(radians(p_lat)) * cos(radians(p.latitude)) * cos(radians(p.longitude - p_lon))
    )))) <= least(greatest(p_radius_miles, 0.1), 50)
  order by (3958.7613 * acos(least(1.0, greatest(-1.0,
    sin(radians(p_lat)) * sin(radians(p.latitude)) +
    cos(radians(p_lat)) * cos(radians(p.latitude)) * cos(radians(p.longitude - p_lon))
  )))), p.created_at desc
  limit least(greatest(p_limit, 1), 40) offset greatest(p_offset, 0);
$$;

-- Keep the original RPC available to existing callers, using the active-time filter.
create or replace function public.nearby_posts(
  p_lat double precision, p_lon double precision,
  p_radius_miles double precision default 10,
  p_limit int default 20, p_offset int default 0
)
returns setof public.posts
language sql stable security invoker
as $$
  select * from public.nearby_posts_filtered(p_lat, p_lon, p_radius_miles, p_limit, p_offset);
$$;

revoke all on function public.nearby_posts_filtered(double precision,double precision,double precision,int,int,text,text,text)
  from public, anon, authenticated;
grant execute on function public.nearby_posts_filtered(double precision,double precision,double precision,int,int,text,text,text)
  to service_role;

-- Existing table RLS and the service-role-only interest/notification function stay in place.
notify pgrst, 'reload schema';
commit;
