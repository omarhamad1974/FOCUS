-- A claim link opened while signed in as the admin must never attach the player's profile
-- to the admin account (it happened once when the admin opened a link to check it).
-- Claiming never changes roles: only the player's directory row and tournament entries.
create or replace function public.claim_player(code text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin cannot claim a player profile';
  end if;
  return public.claim_player_for(code, auth.uid());
end;
$$;

revoke all on function public.claim_player(text) from public, anon;
grant execute on function public.claim_player(text) to authenticated;
