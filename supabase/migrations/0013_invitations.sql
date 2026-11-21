-- Pingo 0013: tournament invitations and organizer biographies.
-- * invitations: the organizer of a tournament (or an admin, for any tournament)
--   invites registered users; the invited player accepts or declines.
--   Accepting enters the player straight away (no second approval), within the player limit.
-- * public_profiles also shows is_organizer, so public profile pages can show the role.
--   (The bio column itself exists since 0004 and anyone may edit their own.)
-- Safe to run more than once.

------------------------------------------------------------------ invitations

create table if not exists public.invitations (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  text not null references public.tournaments (id) on delete cascade,
  player_id      uuid not null references public.profiles (id) on delete cascade,
  invited_by     uuid references public.profiles (id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at     timestamptz not null default now(),
  answered_at    timestamptz,
  unique (tournament_id, player_id)
);
create index if not exists invitations_player_idx on public.invitations (player_id, status);

alter table public.invitations enable row level security;

-- The invited player sees their own; the organizer (or admin) sees the tournament's.
drop policy if exists "invitations: read" on public.invitations;
create policy "invitations: read" on public.invitations
  for select using (player_id = auth.uid() or public.owns_tournament(tournament_id));

-- No direct writes: everything goes through the functions below.
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;

-- Organizer/admin: invite accounts to a tournament that is being prepared or open for
-- registration. People already in (pending or approved) are skipped. A declined or
-- cancelled invitation is sent again. Returns how many invitations were sent.
create or replace function public.invite_players(t text, accounts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; a uuid; sent int := 0;
begin
  if auth.uid() is null or not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  select * into tour from public.tournaments where id = t;
  if tour.status not in ('draft', 'registration') then raise exception 'registration closed'; end if;
  foreach a in array coalesce(accounts, '{}') loop
    continue when not exists (select 1 from public.profiles where id = a);
    continue when exists (select 1 from public.registrations
      where tournament_id = t and player_id = a and status in ('pending', 'approved'));
    insert into public.invitations (tournament_id, player_id, invited_by)
    values (t, a, auth.uid())
    on conflict (tournament_id, player_id) do update
      set status = 'pending', invited_by = auth.uid(), created_at = now(), answered_at = null
      where public.invitations.status in ('declined', 'cancelled');
    if found then sent := sent + 1; end if;
  end loop;
  return sent;
end;
$$;

-- Organizer/admin: take back an invitation that is still waiting.
create or replace function public.cancel_invitation(i uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations where id = i;
  if not found or not public.owns_tournament(inv.tournament_id) then raise exception 'permission denied'; end if;
  update public.invitations set status = 'cancelled', answered_at = now() where id = i and status = 'pending';
end;
$$;

-- Shared by the player's answer and the simulation: enter the invited player.
create or replace function public.accept_invitation_for(i uuid) returns text
language plpgsql security definer set search_path = public as $$
declare inv public.invitations; tour public.tournaments; taken int;
begin
  select * into inv from public.invitations where id = i for update;
  if not found or inv.status <> 'pending' then raise exception 'invitation not found'; end if;
  select * into tour from public.tournaments where id = inv.tournament_id for update;
  if tour.status <> 'registration' then raise exception 'registration closed'; end if;
  select count(*) into taken from public.registrations
    where tournament_id = inv.tournament_id and status in ('pending', 'approved') and player_id <> inv.player_id;
  if tour.max_players is not null and taken >= tour.max_players then raise exception 'tournament full'; end if;
  insert into public.registrations (tournament_id, player_id, status, decided_at)
  values (inv.tournament_id, inv.player_id, 'approved', now())
  on conflict (tournament_id, player_id) do update
    set status = 'approved', created_at = now(), decided_at = now();
  update public.invitations set status = 'accepted', answered_at = now() where id = i;
  return 'approved';
end;
$$;
revoke all on function public.accept_invitation_for(uuid) from public, anon, authenticated;

-- Player: accept (enters the tournament, approved) or decline an invitation.
create or replace function public.answer_invitation(i uuid, accept boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.invitations where id = i and player_id = auth.uid()) then
    raise exception 'invitation not found';
  end if;
  if accept then return public.accept_invitation_for(i); end if;
  update public.invitations set status = 'declined', answered_at = now() where id = i and status = 'pending';
  return 'declined';
end;
$$;

-- Organizer simulation: invited demo players answer (about 4 in 5 accept). Returns how many accepted.
create or replace function public.sim_answer_invitations(t text) returns int
language plpgsql security definer set search_path = public as $$
declare inv record; yes int := 0;
begin
  if not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  for inv in select id from public.invitations
      where tournament_id = t and status = 'pending' and public.is_sim_player(player_id) order by created_at loop
    if random() < 0.8 then
      begin
        perform public.accept_invitation_for(inv.id);
        yes := yes + 1;
      exception when others then
        exit; -- full or closed: leave the rest waiting
      end;
    else
      update public.invitations set status = 'declined', answered_at = now() where id = inv.id;
    end if;
  end loop;
  return yes;
end;
$$;

revoke all on function public.invite_players(text, uuid[]) from public, anon;
revoke all on function public.cancel_invitation(uuid) from public, anon;
revoke all on function public.answer_invitation(uuid, boolean) from public, anon;
revoke all on function public.sim_answer_invitations(text) from public, anon;
grant execute on function public.invite_players(text, uuid[]) to authenticated;
grant execute on function public.cancel_invitation(uuid) to authenticated;
grant execute on function public.answer_invitation(uuid, boolean) to authenticated;
grant execute on function public.sim_answer_invitations(text) to authenticated;

------------------------------------------------------- public profile: organizer flag

-- Same as 0007 plus is_organizer at the end (never phone).
create or replace view public.public_profiles
with (security_invoker = false) as
  select id, full_name, club, bio, is_seller or role = 'admin' as is_seller, is_trainer as is_trainer, avatar_url, gender,
    (coalesce(is_organizer, false) or role in ('organizer', 'admin')) as is_organizer
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;
