-- Organizer privacy (2026-11-23).
-- Organizers no longer read every account. What they keep:
-- * names, clubs and photos of everyone (public_profiles, player_directory), to find and invite people;
-- * phone numbers of their own tournaments' players through tournament_contacts() (WhatsApp messages);
-- * phone and birth year of directory players they added, or who joined or were invited to
--   one of their tournaments, through players_private().
-- Full account records (phone, birth year, claim codes) and claim codes of directory players are admin only.

------------------------------------------------------------------ profiles

drop policy if exists "profiles: read own or as organizer" on public.profiles;
drop policy if exists "profiles: read own or as admin" on public.profiles;
create policy "profiles: read own or as admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

------------------------------------------------------------------- players

-- Everyone signed in who may read a row sees only these columns; phone, birth year
-- and claim code come from players_private().
revoke select on public.players from anon, authenticated;
grant select (id, full_name, club, gender, profile_id, merged_into, created_by, created_at) on public.players to authenticated;

-- Organizers edit only directory players they added; the admin edits all.
drop policy if exists "players: organizers edit" on public.players;
create policy "players: organizers edit" on public.players
  for update using (public.is_admin() or (public.is_organizer() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_organizer() and created_by = auth.uid()));

-- Private details the caller may see: all for the admin (with claim codes); for an organizer,
-- players they added or whose account joined or was invited to one of their tournaments.
create or replace function public.players_private()
returns table (id uuid, phone text, birth_year int, claim_code text)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.phone, pl.birth_year, case when public.is_admin() then pl.claim_code end
  from public.players pl
  where pl.merged_into is null
    and (public.is_admin()
      or (public.is_organizer() and (
        pl.created_by = auth.uid()
        or exists (select 1 from public.registrations g join public.tournaments t on t.id = g.tournament_id
                   where g.player_id = pl.profile_id and t.organizer_id = auth.uid())
        or exists (select 1 from public.invitations i join public.tournaments t on t.id = i.tournament_id
                   where i.player_id = pl.profile_id and t.organizer_id = auth.uid()))));
$$;

revoke all on function public.players_private() from public, anon;
grant execute on function public.players_private() to authenticated;
