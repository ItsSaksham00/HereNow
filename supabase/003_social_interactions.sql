-- Apply after 002_activity_posting.sql. Existing tables, rows, and relationships are preserved.
begin;

-- Return counts and only the current viewer's state for a whole page of posts.
create or replace function public.post_interest_summary(p_posts uuid[], p_viewer uuid)
returns table(post_id uuid, interest_count bigint, interested boolean)
language sql stable security invoker
set search_path = public
as $$
  select requested.post_id,
    count(distinct i.user_id) as interest_count,
    coalesce(bool_or(i.user_id = p_viewer), false) as interested
  from (select distinct unnest(p_posts) as post_id) requested
  left join public.interests i on i.post_id = requested.post_id
  group by requested.post_id;
$$;

-- Save the interest and the creator's named notification in the same transaction.
create or replace function public.express_interest(p_actor uuid, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_creator uuid;
  v_title text;
  v_status text;
  v_expires_at timestamptz;
  v_actor_name text;
  v_interest uuid;
  v_created boolean := false;
begin
  if p_actor is null then
    raise exception 'Sign in required' using errcode = 'P0001';
  end if;

  -- Keep the activity from being changed or deleted while recording the interest.
  select creator_id, title, status, expires_at
    into v_creator, v_title, v_status, v_expires_at
  from public.posts where id = p_post for share;

  if v_creator is null or v_status <> 'PUBLISHED'
    or v_expires_at is null or v_expires_at <= clock_timestamp() then
    raise exception 'Activity unavailable' using errcode = 'P0001';
  end if;
  if v_creator = p_actor then
    raise exception 'Cannot join your own activity' using errcode = 'P0001';
  end if;

  insert into public.interests (user_id, post_id) values (p_actor, p_post)
    on conflict (user_id, post_id) do nothing returning id into v_interest;

  if v_interest is not null then
    v_created := true;
    select nullif(trim(display_name), '') into v_actor_name
      from public.profiles where id = p_actor;
    insert into public.notifications (recipient_id, actor_id, post_id, interest_id, message)
    values (
      v_creator, p_actor, p_post, v_interest,
      format('%s wants to join “%s”.', coalesce(v_actor_name, 'HereNow member'),
        coalesce(nullif(trim(v_title), ''), 'your activity'))
    );
  else
    select id into v_interest from public.interests
      where user_id = p_actor and post_id = p_post;
  end if;

  -- Preserve the existing endpoint's response shape, including on retries.
  return jsonb_build_object('id', v_interest, 'created', v_created);
end $$;

revoke all on function public.post_interest_summary(uuid[],uuid) from public, anon, authenticated;
revoke all on function public.express_interest(uuid,uuid) from public, anon, authenticated;
grant execute on function public.post_interest_summary(uuid[],uuid) to service_role;
grant execute on function public.express_interest(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
