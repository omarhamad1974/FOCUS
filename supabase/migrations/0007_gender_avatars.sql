-- Pingo: male / female choice for the default avatar (Nov 2026). Run after 0001–0006. Safe to run again.
-- * profiles.gender: 'male' or 'female' (empty for accounts made before this).
-- * Sign-up stores the choice; each person can change it on their profile page.
-- * public_profiles shows it, so the right avatar appears for people without a photo.

alter table public.profiles add column if not exists gender text check (gender is null or gender in ('male', 'female'));
grant update (gender) on public.profiles to authenticated;

-- Same as 0004, plus gender from the sign-up form.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare w text;
begin
  insert into public.profiles (id, full_name, phone, birth_year, club, gender)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'birth_year', ''), '[^0-9]', '', 'g'), '')::int,
    nullif(new.raw_user_meta_data ->> 'club', ''),
    case when new.raw_user_meta_data ->> 'gender' in ('male', 'female') then new.raw_user_meta_data ->> 'gender' end
  );
  foreach w in array string_to_array(coalesce(new.raw_user_meta_data ->> 'wants', ''), ',') loop
    if trim(w) in ('organizer', 'seller', 'trainer') then
      insert into public.role_requests (user_id, role) values (new.id, trim(w)) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;

-- Accounts that signed up between this app update and running this file: take it from their sign-up form.
update public.profiles p set gender = u.raw_user_meta_data ->> 'gender'
from auth.users u
where u.id = p.id and p.gender is null and u.raw_user_meta_data ->> 'gender' in ('male', 'female');

-- Public card: same as 0006 plus gender (never phone).
create or replace view public.public_profiles
with (security_invoker = false) as
  select id, full_name, club, bio, is_seller or role = 'admin' as is_seller, is_trainer as is_trainer, avatar_url, gender
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;
