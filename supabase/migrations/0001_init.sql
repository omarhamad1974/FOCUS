-- Pingo database: profiles, tournaments, registrations, with row-level security.
-- Run once in the Supabase SQL Editor (or with `supabase db push`).

-------------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 80),
  phone       text check (phone is null or char_length(phone) <= 30),
  birth_year  int  check (birth_year is null or birth_year between 1920 and 2025),
  club        text check (club is null or char_length(club) <= 80),
  role        text not null default 'player' check (role in ('player', 'organizer', 'admin')),
  created_at  timestamptz not null default now()
);

-- Role helpers. SECURITY DEFINER so they can read profiles without tripping RLS.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

create or replace function public.is_organizer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('organizer', 'admin');
$$;

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, birth_year, club)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'birth_year', '')::int,
    nullif(new.raw_user_meta_data ->> 'club', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only an admin may change anyone's role (blocks self-promotion).
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null only for trusted server-side sessions (SQL Editor);
  -- anonymous API callers cannot reach this row through RLS.
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

alter table public.profiles enable row level security;

-- Users edit their details; role is guarded by the trigger above.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, birth_year, club, role) on public.profiles to authenticated;

drop policy if exists "profiles: read own or as organizer" on public.profiles;
create policy "profiles: read own or as organizer" on public.profiles
  for select using (id = auth.uid() or public.is_organizer());

drop policy if exists "profiles: update own or as admin" on public.profiles;
create policy "profiles: update own or as admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Public directory: names and clubs only (no phone, no birth year).
create or replace view public.player_directory
with (security_invoker = false) as
  select id, full_name, club from public.profiles;
grant select on public.player_directory to anon, authenticated;

----------------------------------------------------------------- tournaments

create table if not exists public.tournaments (
  id            text primary key,
  organizer_id  uuid not null default auth.uid() references public.profiles (id),
  name          text not null check (char_length(name) between 1 and 120),
  date          date,
  status        text not null default 'draft' check (status in ('draft', 'registration', 'running', 'finished')),
  auto_accept   boolean not null default false,
  max_players   int check (max_players is null or max_players between 2 and 512),
  -- Full tournament state (groups, matches, brackets) as used by the app.
  state         jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tournaments_touch on public.tournaments;
create trigger tournaments_touch
  before update on public.tournaments
  for each row execute function public.touch_updated_at();

alter table public.tournaments enable row level security;

drop policy if exists "tournaments: public read unless draft" on public.tournaments;
create policy "tournaments: public read unless draft" on public.tournaments
  for select using (status <> 'draft' or organizer_id = auth.uid() or public.is_admin());

drop policy if exists "tournaments: organizers create" on public.tournaments;
create policy "tournaments: organizers create" on public.tournaments
  for insert with check (public.is_organizer() and organizer_id = auth.uid());

drop policy if exists "tournaments: owner or admin update" on public.tournaments;
create policy "tournaments: owner or admin update" on public.tournaments
  for update using (organizer_id = auth.uid() or public.is_admin())
  with check (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "tournaments: owner or admin delete" on public.tournaments;
create policy "tournaments: owner or admin delete" on public.tournaments
  for delete using (organizer_id = auth.uid() or public.is_admin());

--------------------------------------------------------------- registrations

create table if not exists public.registrations (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  text not null references public.tournaments (id) on delete cascade,
  player_id      uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (tournament_id, player_id)
);

alter table public.registrations enable row level security;

create or replace function public.owns_tournament(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments where id = t and (organizer_id = auth.uid() or public.is_admin()));
$$;

-- Players see their own requests; anyone sees approved entries; organizers see all of theirs.
drop policy if exists "registrations: read" on public.registrations;
create policy "registrations: read" on public.registrations
  for select using (player_id = auth.uid() or status = 'approved' or public.owns_tournament(tournament_id));

-- Only the tournament's organizer (or an admin) approves or rejects.
drop policy if exists "registrations: organizer decides" on public.registrations;
create policy "registrations: organizer decides" on public.registrations
  for update using (public.owns_tournament(tournament_id))
  with check (public.owns_tournament(tournament_id));

-- Organizers may change only the decision, never who registered or for what.
revoke update on public.registrations from anon, authenticated;
grant update (status, decided_at) on public.registrations to authenticated;

drop policy if exists "registrations: organizer removes" on public.registrations;
create policy "registrations: organizer removes" on public.registrations
  for delete using (public.owns_tournament(tournament_id));

-- No direct INSERT policy: players join through join_tournament() so the
-- server checks that registration is open and the tournament is not full.

create or replace function public.join_tournament(t text) returns text
language plpgsql security definer set search_path = public as $$
declare
  tour public.tournaments;
  taken int;
  new_status text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into tour from public.tournaments where id = t for update;
  if not found or tour.status <> 'registration' then raise exception 'registration closed'; end if;
  select count(*) into taken from public.registrations
    where tournament_id = t and status in ('pending', 'approved') and player_id <> auth.uid();
  if tour.max_players is not null and taken >= tour.max_players then raise exception 'tournament full'; end if;
  new_status := case when tour.auto_accept then 'approved' else 'pending' end;
  insert into public.registrations (tournament_id, player_id, status, decided_at)
  values (t, auth.uid(), new_status, case when tour.auto_accept then now() end)
  on conflict (tournament_id, player_id)
    do update set status = excluded.status, created_at = now(), decided_at = excluded.decided_at
    where public.registrations.status in ('withdrawn');
  return (select status from public.registrations where tournament_id = t and player_id = auth.uid());
end;
$$;

create or replace function public.withdraw_from_tournament(t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.registrations set status = 'withdrawn', decided_at = now()
  where tournament_id = t and player_id = auth.uid() and status in ('pending', 'approved')
    and exists (select 1 from public.tournaments where id = t and status = 'registration');
end;
$$;

revoke all on function public.join_tournament(text) from public, anon;
revoke all on function public.withdraw_from_tournament(text) from public, anon;
grant execute on function public.join_tournament(text) to authenticated;
grant execute on function public.withdraw_from_tournament(text) to authenticated;

-------------------------------------------------------------- make an admin
-- After you sign up in the app, run this once with your own email:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'YOUR-EMAIL');
-- (The SQL Editor runs as the database owner, so the role guard allows it.)
