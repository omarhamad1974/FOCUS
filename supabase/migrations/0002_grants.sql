-- Explicit table and function privileges. Newer Supabase projects do not
-- grant these automatically; row-level security still decides which rows.

grant usage on schema public to anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;

grant select on public.registrations to anon, authenticated;
grant delete on public.registrations to authenticated;
-- (update of status/decided_at was granted in 0001)

grant select on public.profiles to authenticated;
-- (update of profile columns was granted in 0001)

grant select on public.player_directory to anon, authenticated;

grant execute on function public.my_role() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_organizer() to anon, authenticated;
grant execute on function public.owns_tournament(text) to anon, authenticated;
grant execute on function public.join_tournament(text) to authenticated;
grant execute on function public.withdraw_from_tournament(text) to authenticated;
