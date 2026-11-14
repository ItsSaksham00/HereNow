-- HereNow initial database schema. Run once in Supabase SQL Editor.
-- Auth stays in Supabase Auth; custom app data is backend-only via the service-role key.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'HereNow member',
  push_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title varchar(100),
  description varchar(1000),
  category varchar(50),
  labels text[] not null default '{}',
  place_name varchar(150) not null,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  status varchar(24) not null default 'ANALYZING'
    check(status in ('ANALYZING','READY','PUBLISHED','EXPIRED','FAILED')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);
create index if not exists posts_current_idx on public.posts(status, expires_at);
create index if not exists posts_creator_idx on public.posts(creator_id, created_at desc);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  object_key text not null unique,
  mime_type varchar(100) not null,
  uploaded_at timestamptz not null default now()
);
create table if not exists public.ai_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  status varchar(20) not null default 'PENDING' check (status in ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  attempts int not null default 0,
  model_name varchar(100),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, post_id)
);
create index if not exists interests_post_idx on public.interests(post_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.posts(id) on delete cascade,
  interest_id uuid references public.interests(id) on delete cascade,
  message text not null,
  is_read boolean not null default false,
  push_status varchar(20) not null default 'NOT_REQUESTED',
  created_at timestamptz not null default now()
);
create index if not exists notifications_inbox_idx on public.notifications(recipient_id, created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body varchar(500) not null check(length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments(post_id, created_at asc);

-- Client uses Supabase Auth only; all app data goes through authenticated NestJS endpoints.
-- RLS prevents accidental app-side public access to records using the publishable key.
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.media_assets enable row level security;
alter table public.ai_analysis_jobs enable row level security;
alter table public.interests enable row level security;
alter table public.notifications enable row level security;
alter table public.comments enable row level security;

-- Return nearest current posts from the selected center. SQL filter + pagination.
create or replace function public.nearby_posts(
  p_lat double precision, p_lon double precision,
  p_radius_miles double precision default 10,
  p_limit int default 20, p_offset int default 0
)
returns setof public.posts
language sql stable security invoker
as $$
  select p.* from public.posts p
  where p.status = 'PUBLISHED'
    and p.expires_at > now()
    and (3958.7613 * acos(least(1.0, greatest(-1.0,
      sin(radians(p_lat)) * sin(radians(p.latitude)) +
      cos(radians(p_lat)) * cos(radians(p.latitude)) *
      cos(radians(p.longitude - p_lon))
    )))) <= least(greatest(p_radius_miles, 0.1), 50)
  order by (3958.7613 * acos(least(1.0, greatest(-1.0,
      sin(radians(p_lat)) * sin(radians(p.latitude)) +
      cos(radians(p_lat)) * cos(radians(p.latitude)) *
      cos(radians(p.longitude - p_lon))
  )))), p.created_at desc
  limit least(greatest(p_limit, 1), 40) offset greatest(p_offset, 0);
$$;

-- Interest and in-app alert MUST commit together. Idempotent on repeat taps.
create or replace function public.express_interest(p_actor uuid, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_creator uuid; v_interest uuid; v_created boolean := false;
begin
  select creator_id into v_creator from public.posts
  where id = p_post and status = 'PUBLISHED' and expires_at > now();
  if v_creator is null then raise exception 'Activity unavailable' using errcode = 'P0001'; end if;
  if v_creator = p_actor then raise exception 'Cannot join your own activity' using errcode = 'P0001'; end if;
  insert into public.interests (user_id, post_id) values (p_actor, p_post)
    on conflict (user_id, post_id) do nothing returning id into v_interest;
  if v_interest is not null then
    v_created := true;
    insert into public.notifications (recipient_id, actor_id, post_id, interest_id, message)
    values (v_creator, p_actor, p_post, v_interest, 'Someone loved your activity and would like to join!');
  else
    select id into v_interest from public.interests where user_id = p_actor and post_id = p_post;
  end if;
  return jsonb_build_object('id',v_interest,'created',v_created);
end $$;

revoke all on function public.nearby_posts(double precision,double precision,double precision,int,int) from public, anon, authenticated;
revoke all on function public.express_interest(uuid,uuid) from public, anon, authenticated;
grant execute on function public.nearby_posts(double precision,double precision,double precision,int,int) to service_role;
grant execute on function public.express_interest(uuid,uuid) to service_role;

-- Storage: private bucket. Images are uploaded by NestJS and served with short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;
