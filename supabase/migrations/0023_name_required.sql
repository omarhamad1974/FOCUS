-- Name required for every account (2026-11-23).
-- The mobile is the username, and the name is how organizers, trainers, sellers and the admin
-- deal with people, so every new account must have a real name.
-- * public.is_real_name: 2+ characters and at least one letter (Arabic or English): never blank,
--   never a mobile typed in the name box. Same rule as isRealName (src/domain/mobile.ts) and
--   nameOk (admin-users function): keep the three equal.
-- * handle_new_user no longer invents a name from the email (for mobile accounts that was the
--   mobile number): an account created without a name is refused, from any path, including the
--   Supabase auth API and dashboard.
-- * profiles and players get a check, so a name can't later be cleared or replaced by digits.
--   Existing rows are not touched: the checks are added NOT VALID and validated only when every
--   row already passes (on 2026-11-23 all live rows did). Otherwise a notice lists how many fail.

create or replace function public.is_real_name(n text) returns boolean
language sql immutable as $$
  -- Digits (also Arabic-Indic) are removed first: some server locales count them as letters.
  select coalesce(char_length(btrim(regexp_replace(n, '\s+', ' ', 'g'))) >= 2
    and regexp_replace(n, '[0-9٠-٩۰-۹]', '', 'g') ~ '[[:alpha:]]', false)
$$;
grant execute on function public.is_real_name(text) to anon, authenticated, service_role;

-- Same as 0017, except the name: required, never taken from the email.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare w text; nm text := btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '\s+', ' ', 'g'));
begin
  if not public.is_real_name(nm) then
    raise exception 'full_name required' using errcode = '23514';
  end if;
  insert into public.profiles (id, full_name, phone, birth_year, club, gender)
  values (
    new.id,
    left(nm, 80),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'birth_year', ''), '[^0-9]', '', 'g'), '')::int,
    nullif(new.raw_user_meta_data ->> 'club', ''),
    case when new.raw_user_meta_data ->> 'gender' in ('male', 'female') then new.raw_user_meta_data ->> 'gender' end
  );
  foreach w in array string_to_array(coalesce(new.raw_user_meta_data ->> 'wants', ''), ',') loop
    if trim(w) in ('organizer', 'seller', 'trainer', 'hall') then
      insert into public.role_requests (user_id, role) values (new.id, trim(w)) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;

alter table public.profiles drop constraint if exists profiles_real_name;
alter table public.profiles add constraint profiles_real_name check (public.is_real_name(full_name)) not valid;
alter table public.players drop constraint if exists players_real_name;
alter table public.players add constraint players_real_name check (public.is_real_name(full_name)) not valid;

do $$
declare bad_profiles int; bad_players int;
begin
  select count(*) into bad_profiles from public.profiles where not public.is_real_name(full_name);
  select count(*) into bad_players from public.players where not public.is_real_name(full_name);
  if bad_profiles = 0 then alter table public.profiles validate constraint profiles_real_name;
  else raise notice '% account(s) have no real name; find them with: select id, full_name, phone from public.profiles where not public.is_real_name(full_name);', bad_profiles;
  end if;
  if bad_players = 0 then alter table public.players validate constraint players_real_name;
  else raise notice '% directory player(s) have no real name; find them with: select id, full_name from public.players where not public.is_real_name(full_name);', bad_players;
  end if;
end;
$$;
