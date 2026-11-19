-- Shared player directory: every person who plays, with or without an account.
-- Organizers add players by name (no email needed); website sign-ups get a row
-- when they first take part. A typed player can later be linked to an account.

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (char_length(full_name) between 1 and 80),
  phone        text check (phone is null or char_length(phone) <= 30),
  club         text check (club is null or char_length(club) <= 80),
  birth_year   int  check (birth_year is null or birth_year between 1920 and 2025),
  -- The account this player signs in with, if any (one row per account).
  profile_id   uuid unique references public.profiles (id) on delete set null,
  -- When two rows turn out to be the same person, the extra row points here.
  merged_into  uuid references public.players (id) on delete set null,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists players_name_idx on public.players (lower(full_name));

alter table public.players enable row level security;

-- Organizers see and manage the directory; a player sees their own row.
drop policy if exists "players: organizers read, players read own" on public.players;
create policy "players: organizers read, players read own" on public.players
  for select using (public.is_organizer() or profile_id = auth.uid());

drop policy if exists "players: organizers add" on public.players;
create policy "players: organizers add" on public.players
  for insert with check (public.is_organizer());

drop policy if exists "players: organizers edit" on public.players;
create policy "players: organizers edit" on public.players
  for update using (public.is_organizer()) with check (public.is_organizer());

drop policy if exists "players: admins delete" on public.players;
create policy "players: admins delete" on public.players
  for delete using (public.is_admin());

grant select, insert, update on public.players to authenticated;
grant delete on public.players to authenticated;

-- Public names for tournament pages: name and club only, never phone.
drop view if exists public.player_directory;
create view public.player_directory
with (security_invoker = false) as
  select p.id as profile_id, coalesce(pl.full_name, p.full_name) as full_name, coalesce(pl.club, p.club) as club
  from public.profiles p
  left join public.players pl on pl.profile_id = p.id and pl.merged_into is null;
grant select on public.player_directory to anon, authenticated;

-- Directory row for an account, created on first use (organizer closes registration).
create or replace function public.player_for_profile(p uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  if not public.is_organizer() then raise exception 'only organizers'; end if;
  select id into pid from public.players where profile_id = p;
  if pid is null then
    insert into public.players (full_name, phone, club, birth_year, profile_id)
      select full_name, phone, club, birth_year, id from public.profiles where id = p
      returning id into pid;
  end if;
  return pid;
end;
$$;

-- Link a typed player to an account. If the account already has its own row,
-- that row is marked as merged into the typed one, so history from both stays.
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
  update public.players set profile_id = account, merged_into = null where id = player;
end;
$$;

revoke all on function public.player_for_profile(uuid) from public, anon;
revoke all on function public.link_player(uuid, uuid) from public, anon;
grant execute on function public.player_for_profile(uuid) to authenticated;
grant execute on function public.link_player(uuid, uuid) to authenticated;
