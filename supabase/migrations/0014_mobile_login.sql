-- Pingo: mobile number as username (Nov 2026). Run after 0001–0013. Safe to run again.
-- * Every player has at least a name and a mobile number. The mobile is the login: the account's
--   hidden email is <mobile>@phone.pingo.example (no SMS, no email is ever sent to it).
-- * Accounts made by an organizer or the admin (one by one or from a file) start with the
--   password "pingo"; the player is asked to change it at first sign-in and can change it anytime.
-- * Claim codes are no longer made; codes already handed out keep working.
-- * Accounts are created by the admin-users Edge Function (actions signup, players, create,
--   set_mobile, reset_password): redeploy it after this file.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Same rules as normalizeMobile() in src/domain/mobile.ts: one way to write each number.
create or replace function public.norm_mobile(raw text) returns text
language plpgsql immutable set search_path = public as $$
declare
  s text := trim(translate(coalesce(raw, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
begin
  if s = '' or s ~* '[a-z@]' then return null; end if;
  s := regexp_replace(s, '[^0-9+]', '', 'g');
  s := regexp_replace(regexp_replace(s, '^\+', ''), '^00', '');
  if s ~ '[^0-9]' then return null; end if;
  if s ~ '^201[0-9]{9}$' then s := '0' || substr(s, 3);
  elsif s ~ '^1[0-9]{9}$' then s := '0' || s;
  end if;
  if length(s) < 8 or length(s) > 15 then return null; end if;
  return s;
end;
$$;

-- The account that signs in with this mobile, else the one account whose profile has it.
create or replace function public.account_by_mobile(m text) returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare
  mob text := public.norm_mobile(m);
  hit uuid;
begin
  if mob is null then return null; end if;
  select id into hit from auth.users where lower(email) = mob || '@phone.pingo.example' limit 1;
  if hit is not null then return hit; end if;
  select p.id into hit from public.profiles p
    where public.norm_mobile(p.phone) = mob and p.merged_into is null
      and (select count(*) from public.profiles q where public.norm_mobile(q.phone) = mob and q.merged_into is null) = 1;
  return hit;
end;
$$;

-- After the Edge Function made (or re-pointed) an account for a mobile: phone, details,
-- the default password when asked, and a directory row (an existing directory player is linked).
create or replace function public.setup_mobile_player(account uuid, mobile text, club text default null,
  gender text default null, birth_year int default null, directory uuid default null, default_password boolean default true)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  mob text := public.norm_mobile(mobile);
  row_id uuid;
begin
  if mob is null then raise exception 'bad mobile'; end if;
  if default_password then
    update auth.users set encrypted_password = extensions.crypt('pingo', extensions.gen_salt('bf')) where id = account;
  end if;
  update public.profiles p set
    phone = mob,
    is_temp = false,
    claim_code = null,
    must_change_password = p.must_change_password or default_password,
    club = coalesce(nullif(trim(coalesce(setup_mobile_player.club, '')), ''), p.club),
    gender = case when setup_mobile_player.gender in ('male', 'female') then setup_mobile_player.gender else p.gender end,
    birth_year = case when setup_mobile_player.birth_year between 1920 and 2025 then setup_mobile_player.birth_year else p.birth_year end
  where p.id = account;
  if not found then raise exception 'profile not found'; end if;
  -- A directory player without an account becomes this account's row.
  if directory is not null and not exists (select 1 from public.players where profile_id = account) then
    update public.players set profile_id = account, claim_code = null
      where id = directory and profile_id is null and merged_into is null;
    if found then perform public.attach_account_in_tournaments(directory, account); end if;
  end if;
  insert into public.players (full_name, phone, club, gender, birth_year, profile_id, created_by)
    select p.full_name, p.phone, p.club, p.gender, p.birth_year, p.id, null from public.profiles p where p.id = account
    on conflict (profile_id) do nothing;
  update public.players pl set phone = mob,
    club = coalesce(pl.club, (select pr.club from public.profiles pr where pr.id = account)),
    gender = coalesce(pl.gender, (select pr.gender from public.profiles pr where pr.id = account))
    where pl.profile_id = account
    returning pl.id into row_id;
  return row_id;
end;
$$;

-- The admin's "reset to pingo" for a player who forgot their password.
create or replace function public.reset_default_password(account uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  update auth.users set encrypted_password = extensions.crypt('pingo', extensions.gen_salt('bf')) where id = account;
  if not found then raise exception 'account not found'; end if;
  update public.profiles set must_change_password = true where id = account;
end;
$$;

-- The signed-in player chose their own password.
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- Batch entry with names only is replaced by name + mobile (admin-users action 'players').
create or replace function public.batch_add_players(names text[], club text default null, gender text default null)
returns table (id uuid, full_name text, claim_code text, existed boolean, has_account boolean)
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'use the admin-users players action';
end;
$$;

revoke all on function public.norm_mobile(text) from public;
revoke all on function public.account_by_mobile(text) from public, anon, authenticated;
revoke all on function public.setup_mobile_player(uuid, text, text, text, int, uuid, boolean) from public, anon, authenticated;
revoke all on function public.reset_default_password(uuid) from public, anon, authenticated;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.norm_mobile(text) to anon, authenticated;
grant execute on function public.password_changed() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.norm_mobile(text) to service_role';
    execute 'grant execute on function public.account_by_mobile(text) to service_role';
    execute 'grant execute on function public.setup_mobile_player(uuid, text, text, text, int, uuid, boolean) to service_role';
    execute 'grant execute on function public.reset_default_password(uuid) to service_role';
    execute 'grant execute on function public.batch_match_names(text[]) to service_role';
  end if;
end $$;
