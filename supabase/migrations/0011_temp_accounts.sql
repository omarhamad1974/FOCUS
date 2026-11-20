-- Pingo: admin-only batch players with temporary accounts (Nov 2026). Run after 0001–0010. Safe to run again.
-- * Only the admin adds a batch of names. Each new name gets a temporary account (no real email,
--   no password anyone knows) with a claim code, so it can be put on any tournament's waiting list.
-- * The admin can add a batch of names to a tournament's waiting list (pending requests); the
--   organizer approves them and draws groups as usual.
-- * The player completes registration later from the claim link: the same account gets their
--   email and password (admin-users Edge Function, action 'claim'), so nothing has to move.
-- * Accounts are created by the admin-users Edge Function (action 'batch'): redeploy it after this file.

alter table public.profiles add column if not exists is_temp boolean not null default false;
alter table public.profiles add column if not exists claim_code text unique
  check (claim_code is null or claim_code ~ '^[A-Z2-9]{8}$');
-- A temporary account whose player linked it to their existing account instead.
alter table public.profiles add column if not exists merged_into uuid references public.profiles (id) on delete set null;

-- Codes are unique across directory players and temporary accounts.
create or replace function public.new_claim_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  code text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 31), 1);
    end loop;
    exit when not exists (select 1 from public.players where claim_code = code)
      and not exists (select 1 from public.profiles where claim_code = code);
  end loop;
  return code;
end;
$$;

-- Batch entry is for the admin only now (directory-only batch from 0008).
create or replace function public.batch_add_players(names text[], club text default null, gender text default null)
returns table (id uuid, full_name text, claim_code text, existed boolean, has_account boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin'; end if;
  raise exception 'use the admin-users batch action';
end;
$$;

create or replace function public.renew_claim_code(player uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if not public.is_admin() then raise exception 'only an admin'; end if;
  code := public.new_claim_code();
  -- A temporary account (player = profile id) or a directory player without an account.
  update public.profiles set claim_code = code where id = player and is_temp;
  if found then return code; end if;
  if exists (select 1 from public.players where id = player and profile_id is not null) then
    raise exception 'already claimed';
  end if;
  update public.players set claim_code = code where id = player and merged_into is null;
  if not found then raise exception 'player not found'; end if;
  return code;
end;
$$;

-- For each pasted name: the account it matches. A temporary account with that exact name wins;
-- otherwise a real account when exactly one has that name; otherwise none (a new one is made).
create or replace function public.batch_match_names(names text[])
returns table (name text, account uuid, kind text, claim_code text)
language plpgsql stable security definer set search_path = public as $$
declare
  nm text;
  hit public.profiles;
  n int;
begin
  foreach nm in array names loop
    hit := null;
    select * into hit from public.profiles p
      where p.is_temp and p.merged_into is null and lower(p.full_name) = lower(nm)
      order by p.created_at limit 1;
    if hit.id is not null then
      return query select nm, hit.id, 'temp'::text, hit.claim_code; continue;
    end if;
    select count(*) into n from public.profiles p
      where not p.is_temp and p.merged_into is null and lower(p.full_name) = lower(nm);
    if n = 1 then
      select * into hit from public.profiles p
        where not p.is_temp and p.merged_into is null and lower(p.full_name) = lower(nm);
      return query select nm, hit.id, 'account'::text, null::text; continue;
    end if;
    return query select nm, null::uuid, case when n > 1 then 'many' else 'none' end, null::text;
  end loop;
end;
$$;

-- After the Edge Function made the auth user: mark it temporary, give it a code and a directory row.
create or replace function public.setup_temp_player(account uuid, club text default null, gender text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := public.new_claim_code();
begin
  update public.profiles p set is_temp = true, claim_code = code,
    club = coalesce(nullif(trim(coalesce(setup_temp_player.club, '')), ''), p.club),
    gender = case when setup_temp_player.gender in ('male', 'female') then setup_temp_player.gender else p.gender end
  where p.id = account;
  if not found then raise exception 'profile not found'; end if;
  insert into public.players (full_name, club, gender, profile_id, created_by)
    select p.full_name, p.club, p.gender, p.id, null from public.profiles p where p.id = account
    on conflict (profile_id) do nothing;
  return code;
end;
$$;

-- Put accounts on a tournament's waiting list (pending), as if each had asked to join.
-- Players already on the list keep their status; withdrawn or rejected ones come back as pending.
create or replace function public.waitlist_add(t text, accounts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  added int;
begin
  if not exists (select 1 from public.tournaments where id = t) then raise exception 'tournament not found'; end if;
  with ins as (
    insert into public.registrations (tournament_id, player_id, status)
    select t, a, 'pending' from unnest(accounts) as a
    where exists (select 1 from public.profiles where id = a)
    on conflict (tournament_id, player_id)
      do update set status = 'pending', created_at = now(), decided_at = null
      where public.registrations.status in ('withdrawn', 'rejected')
    returning 1)
  select count(*) into added from ins;
  return added;
end;
$$;

-- The admin, from the app: put existing accounts on a waiting list.
create or replace function public.admin_waitlist_add(t text, accounts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin'; end if;
  return public.waitlist_add(t, accounts);
end;
$$;

-- What the claim page shows: works for temporary accounts and directory players. Never phone or email.
create or replace function public.claim_info(code text)
returns table (full_name text, club text, gender text, tournaments int)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.club, p.gender,
    (select count(*)::int from public.registrations r where r.player_id = p.id and r.status in ('pending', 'approved'))
  from public.profiles p
  where p.claim_code = public.clean_claim_code(code) and p.is_temp and p.merged_into is null
  union all
  select pl.full_name, pl.club, pl.gender,
    (select count(*)::int from public.tournaments t
      where t.state -> 'players' @> jsonb_build_array(jsonb_build_object('directoryId', pl.id::text)))
  from public.players pl
  where pl.claim_code = public.clean_claim_code(code) and pl.profile_id is null and pl.merged_into is null;
$$;

-- The temporary account behind a code (Edge Function: gives it the player's email and password).
create or replace function public.temp_account_for(code text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
  where claim_code = public.clean_claim_code(code) and is_temp and merged_into is null;
$$;

-- After the Edge Function set the player's email and password: the account is theirs now.
create or replace function public.finish_temp_account(account uuid, gender text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set is_temp = false, claim_code = null,
    gender = case when finish_temp_account.gender in ('male', 'female') then finish_temp_account.gender else p.gender end
  where p.id = account and p.is_temp;
end;
$$;

-- Swap one account id for another inside saved tournaments (profileId / accountId of players).
create or replace function public.replace_account_in_tournaments(old_id uuid, new_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.tournaments t
  set state = jsonb_set(t.state, '{players}', (
    select coalesce(jsonb_agg(
      case
        when p ->> 'profileId' = old_id::text or p ->> 'accountId' = old_id::text then
          p || (case when p ? 'profileId' and p ->> 'profileId' = old_id::text then jsonb_build_object('profileId', new_id::text) else '{}'::jsonb end)
            || (case when p ? 'accountId' and p ->> 'accountId' = old_id::text then jsonb_build_object('accountId', new_id::text) else '{}'::jsonb end)
        else p end
      order by ord), '[]'::jsonb)
    from jsonb_array_elements(t.state -> 'players') with ordinality as x(p, ord)))
  where jsonb_typeof(t.state -> 'players') = 'array'
    and (t.state -> 'players' @> jsonb_build_array(jsonb_build_object('profileId', old_id::text))
      or t.state -> 'players' @> jsonb_build_array(jsonb_build_object('accountId', old_id::text)));
end;
$$;

-- A signed-in player (never the admin) takes a code: a temporary account is merged into theirs
-- (waiting lists, directory row, tournaments); a directory code works as before (0008).
create or replace function public.claim_player(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tmp uuid;
  tmp_row uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = me and role = 'admin') then
    raise exception 'admin cannot claim a player profile';
  end if;
  tmp := public.temp_account_for(code);
  if tmp is null then return public.claim_player_for(code, me); end if;
  if tmp = me then raise exception 'claim code not found'; end if;
  -- Waiting lists and entries: move what does not clash, drop the rest.
  update public.registrations r set player_id = me
    where r.player_id = tmp
      and not exists (select 1 from public.registrations x where x.player_id = me and x.tournament_id = r.tournament_id);
  delete from public.registrations where player_id = tmp;
  -- Directory: the temporary row becomes the player's row (their own older row is merged into it).
  select id into tmp_row from public.players where profile_id = tmp;
  if tmp_row is not null then
    update public.players set profile_id = null, merged_into = tmp_row where profile_id = me;
    update public.players set profile_id = me, claim_code = null where id = tmp_row;
    perform public.attach_account_in_tournaments(tmp_row, me);
  end if;
  perform public.replace_account_in_tournaments(tmp, me);
  update public.profiles p set
    club = coalesce(p.club, (select club from public.profiles where id = tmp)),
    gender = coalesce(p.gender, (select gender from public.profiles where id = tmp))
  where p.id = me;
  update public.profiles set claim_code = null, is_temp = false, merged_into = me where id = tmp;
  return coalesce(tmp_row, tmp);
end;
$$;

revoke all on function public.batch_match_names(text[]) from public, anon, authenticated;
revoke all on function public.setup_temp_player(uuid, text, text) from public, anon, authenticated;
revoke all on function public.waitlist_add(text, uuid[]) from public, anon, authenticated;
revoke all on function public.temp_account_for(text) from public, anon, authenticated;
revoke all on function public.finish_temp_account(uuid, text) from public, anon, authenticated;
revoke all on function public.replace_account_in_tournaments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_waitlist_add(text, uuid[]) from public, anon;
revoke all on function public.claim_player(text) from public, anon;
revoke all on function public.claim_info(text) from public;
grant execute on function public.admin_waitlist_add(text, uuid[]) to authenticated;
grant execute on function public.claim_player(text) to authenticated;
grant execute on function public.claim_info(text) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.batch_match_names(text[]) to service_role';
    execute 'grant execute on function public.setup_temp_player(uuid, text, text) to service_role';
    execute 'grant execute on function public.waitlist_add(text, uuid[]) to service_role';
    execute 'grant execute on function public.temp_account_for(text) to service_role';
    execute 'grant execute on function public.finish_temp_account(uuid, text) to service_role';
    execute 'grant execute on function public.claim_info(text) to service_role';
    execute 'grant all on public.profiles, public.players, public.registrations to service_role';
  end if;
end $$;
