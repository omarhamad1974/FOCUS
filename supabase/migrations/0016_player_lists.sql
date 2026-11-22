-- Pingo 0016: player blacklists and organizers' favourite players (Omar, 2026-11-22).
-- * An organizer can blacklist a player and take them off again. A player on an organizer's
--   blacklist cannot join, be invited to or be added to that organizer's tournaments, but can
--   join anyone else's.
-- * The admin's blacklist (owner_id is null) blocks a player from every tournament.
-- * Blacklisting takes the player out of the owner's tournaments that are still open for
--   registration (their request or place becomes "rejected") and cancels pending invitations.
--   Tournaments that already started are left as they are.
-- * Organizers mark favourite players and add or invite them to a new tournament in one go.
-- The database enforces the blacklist (trigger on registrations and invitations), not only the app.
-- Safe to run more than once.

------------------------------------------------------------------ blacklist

create table if not exists public.blacklist (
  id          uuid primary key default gen_random_uuid(),
  -- The organizer whose tournaments the player cannot enter; null = the whole site (admin).
  owner_id    uuid references public.profiles (id) on delete cascade,
  player_id   uuid not null references public.profiles (id) on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 200),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists blacklist_owner_player_idx
  on public.blacklist (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), player_id);
create index if not exists blacklist_player_idx on public.blacklist (player_id);

alter table public.blacklist enable row level security;

-- Organizers see their own list and the site-wide one (so the app can mark those players);
-- the admin sees every list. Players never read it (my_blocks() tells them only where they cannot join).
drop policy if exists "blacklist: read" on public.blacklist;
create policy "blacklist: read" on public.blacklist
  for select using (owner_id = auth.uid() or public.is_admin() or (owner_id is null and public.is_organizer()));

revoke all on public.blacklist from anon, authenticated;
grant select on public.blacklist to authenticated;
grant all on public.blacklist to service_role;

-- Is player p blocked from tournament t (by its organizer or by the admin)?
create or replace function public.is_blocked(t text, p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blacklist b
    where b.player_id = p
      and (b.owner_id is null or b.owner_id = (select organizer_id from public.tournaments where id = t)));
$$;

-- Organizer (site = false: own list) or admin (site = true: everyone's tournaments) blacklists a player.
-- Returns how many registrations were taken out of open tournaments.
create or replace function public.blacklist_add(p uuid, reason text default null, site boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare own uuid; removed int;
begin
  if auth.uid() is null then raise exception 'permission denied'; end if;
  if site then
    if not public.is_admin() then raise exception 'only an admin can do this'; end if;
    own := null;
  else
    if not public.is_organizer() then raise exception 'permission denied'; end if;
    own := auth.uid();
  end if;
  if p = auth.uid() then raise exception 'cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p) then raise exception 'player not found'; end if;
  if exists (select 1 from public.profiles where id = p and role = 'admin') then raise exception 'cannot block an admin'; end if;

  delete from public.blacklist where player_id = p and owner_id is not distinct from own;
  insert into public.blacklist (owner_id, player_id, reason, created_by)
  values (own, p, nullif(btrim(coalesce(reason, '')), ''), auth.uid());

  -- Out of the owner's tournaments that are still being prepared or open for registration.
  with gone as (
    update public.registrations r set status = 'rejected', decided_at = now()
    from public.tournaments tm
    where tm.id = r.tournament_id and r.player_id = p and r.status in ('pending', 'approved')
      and tm.status in ('draft', 'registration') and (own is null or tm.organizer_id = own)
    returning 1)
  select count(*) into removed from gone;

  update public.invitations i set status = 'cancelled', answered_at = now()
  from public.tournaments tm
  where tm.id = i.tournament_id and i.player_id = p and i.status = 'pending'
    and (own is null or tm.organizer_id = own);

  if own is not null then
    delete from public.favourite_players where owner_id = own and player_id = p;
  end if;
  return removed;
end;
$$;

-- Take a player off the caller's list (or, for the admin with site = true, off the site-wide list).
create or replace function public.blacklist_remove(p uuid, site boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'permission denied'; end if;
  if site then
    if not public.is_admin() then raise exception 'only an admin can do this'; end if;
    delete from public.blacklist where player_id = p and owner_id is null;
  else
    delete from public.blacklist where player_id = p and owner_id = auth.uid();
  end if;
end;
$$;

-- The signed-in player: whose tournaments they cannot join (null = every tournament). No reasons.
create or replace function public.my_blocks() returns table (owner_id uuid)
language sql stable security definer set search_path = public as $$
  select b.owner_id from public.blacklist b where b.player_id = auth.uid();
$$;

------------------------------------------------- enforcement (every path)

-- No blocked player can become pending or approved in a tournament, whichever function
-- or screen tries it (joining, accepting an invitation, the organizer approving, waiting lists).
-- (A claim moving a waiting-list entry to the claiming account keeps its status and is not checked.)
create or replace function public.registrations_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('pending', 'approved')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and public.is_blocked(new.tournament_id, new.player_id) then
    raise exception 'player blocked';
  end if;
  return new;
end;
$$;
drop trigger if exists registrations_block_guard on public.registrations;
create trigger registrations_block_guard
  before insert or update on public.registrations
  for each row execute function public.registrations_block_guard();

-- Invitations to a blocked player are skipped quietly (invite_players counts only the ones sent).
create or replace function public.invitations_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and public.is_blocked(new.tournament_id, new.player_id) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists invitations_block_guard on public.invitations;
create trigger invitations_block_guard
  before insert or update on public.invitations
  for each row execute function public.invitations_block_guard();

-- Batch helpers skip blocked players instead of failing the whole batch (same as 0011/0012 otherwise).
create or replace function public.waitlist_add(t text, accounts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  added int;
begin
  if not exists (select 1 from public.tournaments where id = t) then raise exception 'tournament not found'; end if;
  with ins as (
    insert into public.registrations (tournament_id, player_id, status)
    select t, a, 'pending' from unnest(accounts) as a
    where exists (select 1 from public.profiles where id = a) and not public.is_blocked(t, a)
    on conflict (tournament_id, player_id)
      do update set status = 'pending', created_at = now(), decided_at = null
      where public.registrations.status in ('withdrawn', 'rejected')
    returning 1)
  select count(*) into added from ins;
  return added;
end;
$$;

create or replace function public.sim_join(t text, players uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; taken int; added int := 0; p uuid;
begin
  if not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  select * into tour from public.tournaments where id = t for update;
  if tour.status <> 'registration' then raise exception 'registration closed'; end if;
  foreach p in array coalesce(players, '{}') loop
    continue when not public.is_sim_player(p);
    continue when public.is_blocked(t, p);
    select count(*) into taken from public.registrations
      where tournament_id = t and status in ('pending', 'approved');
    exit when tour.max_players is not null and taken >= tour.max_players;
    insert into public.registrations (tournament_id, player_id, status, decided_at)
    values (t, p, case when tour.auto_accept then 'approved' else 'pending' end, case when tour.auto_accept then now() end)
    on conflict (tournament_id, player_id) do update
      set status = excluded.status, created_at = now(), decided_at = excluded.decided_at
      where public.registrations.status in ('withdrawn', 'rejected');
    if found then added := added + 1; end if;
  end loop;
  return added;
end;
$$;

------------------------------------------------------------ favourites

create table if not exists public.favourite_players (
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  player_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (owner_id, player_id),
  check (owner_id <> player_id)
);

alter table public.favourite_players enable row level security;

drop policy if exists "favourites: own read" on public.favourite_players;
create policy "favourites: own read" on public.favourite_players
  for select using (owner_id = auth.uid());
drop policy if exists "favourites: organizers add" on public.favourite_players;
create policy "favourites: organizers add" on public.favourite_players
  for insert with check (owner_id = auth.uid() and public.is_organizer()
    and not exists (select 1 from public.blacklist b where b.owner_id = auth.uid() and b.player_id = favourite_players.player_id));
drop policy if exists "favourites: own delete" on public.favourite_players;
create policy "favourites: own delete" on public.favourite_players
  for delete using (owner_id = auth.uid());

revoke all on public.favourite_players from anon, authenticated;
grant select, insert, delete on public.favourite_players to authenticated;
grant all on public.favourite_players to service_role;

-- Organizer/admin: put accounts straight into a tournament as approved players (favourites
-- in one tap). Skips blocked players and people already in; stops at the player limit.
-- Returns how many were added.
create or replace function public.org_add_players(t text, accounts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; taken int; added int := 0; a uuid;
begin
  if auth.uid() is null or not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  select * into tour from public.tournaments where id = t for update;
  if tour.status not in ('draft', 'registration') then raise exception 'registration closed'; end if;
  foreach a in array coalesce(accounts, '{}') loop
    continue when not exists (select 1 from public.profiles where id = a);
    continue when public.is_blocked(t, a);
    select count(*) into taken from public.registrations
      where tournament_id = t and status in ('pending', 'approved') and player_id <> a;
    exit when tour.max_players is not null and taken >= tour.max_players;
    insert into public.registrations (tournament_id, player_id, status, decided_at)
    values (t, a, 'approved', now())
    on conflict (tournament_id, player_id) do update
      set status = 'approved', created_at = now(), decided_at = now()
      where public.registrations.status <> 'approved';
    if found then
      added := added + 1;
      update public.invitations set status = 'accepted', answered_at = now()
        where tournament_id = t and player_id = a and status = 'pending';
    end if;
  end loop;
  return added;
end;
$$;

------------------------------------------------------------------ grants

revoke all on function public.is_blocked(text, uuid) from public, anon, authenticated;
revoke all on function public.registrations_block_guard() from public, anon, authenticated;
revoke all on function public.invitations_block_guard() from public, anon, authenticated;
revoke all on function public.waitlist_add(text, uuid[]) from public, anon, authenticated;
revoke all on function public.blacklist_add(uuid, text, boolean) from public, anon;
revoke all on function public.blacklist_remove(uuid, boolean) from public, anon;
revoke all on function public.my_blocks() from public, anon;
revoke all on function public.org_add_players(text, uuid[]) from public, anon;
revoke all on function public.sim_join(text, uuid[]) from public, anon;
grant execute on function public.blacklist_add(uuid, text, boolean) to authenticated;
grant execute on function public.blacklist_remove(uuid, boolean) to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.org_add_players(text, uuid[]) to authenticated;
grant execute on function public.sim_join(text, uuid[]) to authenticated;
grant execute on function public.is_blocked(text, uuid) to service_role;
grant execute on function public.waitlist_add(text, uuid[]) to service_role;
