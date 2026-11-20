-- Pingo: batch player entry and claim codes (Nov 2026). Run after 0001–0007. Safe to run again.
-- * An organizer or admin pastes a list of names: each becomes a player in the directory,
--   ready for tournaments, with a personal claim code (e.g. K7PM-3QXA).
-- * The player opens the claim link, sets their own email, password and photo, and the
--   directory row (with every tournament result) is attached to the new account.
-- * Already signed in? claim_player(code) attaches the row to the current account.
-- * The account is created by the admin-users Edge Function (action 'claim'), which calls
--   claim_player_for() with the service role. Redeploy admin-users after this file.

alter table public.players add column if not exists claim_code text unique
  check (claim_code is null or claim_code ~ '^[A-Z2-9]{8}$');
alter table public.players add column if not exists gender text
  check (gender is null or gender in ('male', 'female'));

-- 8 characters from 31 easy-to-read letters and digits (no 0/O, 1/I/L): about 850 billion codes.
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
    exit when not exists (select 1 from public.players where claim_code = code);
  end loop;
  return code;
end;
$$;

-- Accept codes typed with a dash, spaces or small letters.
create or replace function public.clean_claim_code(code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Put the account on this player in every saved tournament, so photos and "my matches" work.
create or replace function public.attach_account_in_tournaments(player uuid, account uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.tournaments t
  set state = jsonb_set(t.state, '{players}', (
    select coalesce(jsonb_agg(
      case when p ->> 'directoryId' = player::text then p || jsonb_build_object('accountId', account::text) else p end
      order by ord), '[]'::jsonb)
    from jsonb_array_elements(t.state -> 'players') with ordinality as x(p, ord)))
  where jsonb_typeof(t.state -> 'players') = 'array'
    and t.state -> 'players' @> jsonb_build_array(jsonb_build_object('directoryId', player::text));
end;
$$;

-- Same as 0003, and now also fills in the account in saved tournaments.
create or replace function public.link_player(player uuid, account uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if not public.is_organizer() then raise exception 'only organizers'; end if;
  select id into other from public.players where profile_id = account and id <> player;
  if other is not null then
    update public.players set profile_id = null, merged_into = player where id = other;
  end if;
  update public.players set profile_id = account, merged_into = null, claim_code = null where id = player;
  perform public.attach_account_in_tournaments(player, account);
end;
$$;

-- Batch entry. Names that already exist in the directory (same spelling, any case) are reused,
-- not duplicated. Every player without an account gets a claim code.
create or replace function public.batch_add_players(names text[], club text default null, gender text default null)
returns table (id uuid, full_name text, claim_code text, existed boolean, has_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  nm text;
  seen text[] := '{}';
  row_id uuid;
  row_account uuid;
  row_code text;
  row_name text;
begin
  if not public.is_organizer() then raise exception 'only organizers'; end if;
  if coalesce(array_length(names, 1), 0) > 300 then raise exception 'too many names'; end if;
  if gender is not null and gender not in ('male', 'female') then gender := null; end if;
  club := nullif(trim(coalesce(club, '')), '');
  foreach nm in array names loop
    nm := regexp_replace(trim(coalesce(nm, '')), '\s+', ' ', 'g');
    continue when nm = '' or char_length(nm) > 80 or lower(nm) = any (seen);
    seen := seen || lower(nm);
    select pl.id, pl.full_name, pl.profile_id, pl.claim_code into row_id, row_name, row_account, row_code
      from public.players pl
      where lower(pl.full_name) = lower(nm) and pl.merged_into is null
      order by pl.profile_id nulls last, pl.created_at
      limit 1;
    if row_id is not null then
      if row_account is null and row_code is null then
        row_code := public.new_claim_code();
        update public.players pl set claim_code = row_code where pl.id = row_id;
      end if;
      return query select row_id, row_name, row_code, true, row_account is not null;
    else
      row_code := public.new_claim_code();
      insert into public.players as pl (full_name, club, gender, claim_code)
        values (nm, club, gender, row_code) returning pl.id into row_id;
      return query select row_id, nm, row_code, false, false;
    end if;
    row_id := null; row_account := null; row_code := null;
  end loop;
end;
$$;

-- Give one directory player a claim code (or a new one, which cancels the old code).
create or replace function public.renew_claim_code(player uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if not public.is_organizer() then raise exception 'only organizers'; end if;
  if exists (select 1 from public.players where id = player and profile_id is not null) then
    raise exception 'already claimed';
  end if;
  code := public.new_claim_code();
  update public.players set claim_code = code where id = player and merged_into is null;
  if not found then raise exception 'player not found'; end if;
  return code;
end;
$$;

-- What the claim page shows before sign-up: name, club, gender and how many tournaments. Never phone.
create or replace function public.claim_info(code text)
returns table (full_name text, club text, gender text, tournaments int)
language sql stable security definer set search_path = public as $$
  select pl.full_name, pl.club, pl.gender,
    (select count(*)::int from public.tournaments t
      where t.state -> 'players' @> jsonb_build_array(jsonb_build_object('directoryId', pl.id::text)))
  from public.players pl
  where pl.claim_code = public.clean_claim_code(code) and pl.profile_id is null and pl.merged_into is null;
$$;

-- Attach the player with this code to an account. Used by the Edge Function (service role)
-- and, through claim_player(), by a signed-in person for their own account.
create or replace function public.claim_player_for(code text, account uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pl public.players;
  other uuid;
begin
  select * into pl from public.players
    where claim_code = public.clean_claim_code(code) and profile_id is null and merged_into is null
    for update;
  if pl.id is null then raise exception 'claim code not found'; end if;
  -- The account's own directory row, if it already played: keep its history by merging it.
  select id into other from public.players where profile_id = account;
  if other is not null then
    update public.players set profile_id = null, merged_into = pl.id where id = other;
  end if;
  update public.players set profile_id = account, claim_code = null where id = pl.id;
  -- Fill blanks on the profile from what the organizer typed.
  update public.profiles p set
    club = coalesce(p.club, pl.club),
    phone = coalesce(p.phone, pl.phone),
    birth_year = coalesce(p.birth_year, pl.birth_year),
    gender = coalesce(p.gender, pl.gender)
  where p.id = account;
  perform public.attach_account_in_tournaments(pl.id, account);
  return pl.id;
end;
$$;

create or replace function public.claim_player(code text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return public.claim_player_for(code, auth.uid());
end;
$$;

revoke all on function public.new_claim_code() from public, anon, authenticated;
revoke all on function public.attach_account_in_tournaments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_player_for(text, uuid) from public, anon, authenticated;
revoke all on function public.batch_add_players(text[], text, text) from public, anon;
revoke all on function public.renew_claim_code(uuid) from public, anon;
revoke all on function public.claim_player(text) from public, anon;
revoke all on function public.claim_info(text) from public;
grant execute on function public.clean_claim_code(text) to anon, authenticated;
grant execute on function public.batch_add_players(text[], text, text) to authenticated;
grant execute on function public.renew_claim_code(uuid) to authenticated;
grant execute on function public.claim_player(text) to authenticated;
grant execute on function public.claim_info(text) to anon, authenticated;
grant execute on function public.link_player(uuid, uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_player_for(text, uuid) to service_role';
    execute 'grant execute on function public.claim_info(text) to service_role';
  end if;
end $$;

-- Organizers may edit a typed player's gender (used for the avatar until the player claims).
grant update (gender) on public.players to authenticated;
