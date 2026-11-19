-- Pingo: revised rules (Nov 2026). Run after 0001–0005. Safe to run again.
-- * News is written and managed by admins only.
-- * Products need admin approval; admins pick featured products.
-- * Profile photos (shown for participants and winners).
-- * Tournament assistants who may only enter match results.

------------------------------------------------------------ profile photo

alter table public.profiles add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500);
grant update (avatar_url) on public.profiles to authenticated;

create or replace view public.public_profiles
with (security_invoker = false) as
  select id, full_name, club, bio, is_seller or role = 'admin' as is_seller, is_trainer as is_trainer, avatar_url
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

--------------------------------------------------------------- news: admin

drop policy if exists "posts: writers add" on public.posts;
create policy "posts: writers add" on public.posts
  for insert with check (public.is_admin() and author_id = auth.uid());

drop policy if exists "posts: author or admin edit" on public.posts;
create policy "posts: author or admin edit" on public.posts
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "posts: author or admin delete" on public.posts;
create policy "posts: author or admin delete" on public.posts
  for delete using (public.is_admin());

----------------------------------------------- products: approval, featured

-- Products listed before this rule existed stay visible (only on the first run).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'approved') then
    alter table public.products add column approved boolean not null default false;
    update public.products set approved = true;
  end if;
end $$;
alter table public.products add column if not exists featured boolean not null default false;

drop policy if exists "products: read active" on public.products;
create policy "products: read active" on public.products
  for select using ((active and approved) or seller_id = auth.uid() or public.is_admin());

-- Only sellers list products (admins manage them, they do not need the seller role to approve).
drop policy if exists "products: sellers add" on public.products;
create policy "products: sellers add" on public.products
  for insert with check (public.is_seller() and seller_id = auth.uid() and not approved and not featured);

grant update (approved, featured) on public.products to authenticated;

-- Only an admin changes approval or featured. A seller who changes what buyers
-- see (name, description, photo, category) sends the product back for approval.
create or replace function public.guard_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.approved is distinct from old.approved or new.featured is distinct from old.featured then
    raise exception 'only an admin can approve products';
  end if;
  if new.name is distinct from old.name or new.description is distinct from old.description
     or new.image_url is distinct from old.image_url or new.category is distinct from old.category then
    new.approved := false;
    new.featured := false;
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard on public.products;
create trigger products_guard before update on public.products
  for each row execute function public.guard_product();

------------------------------------------------------ tournament assistants

create table if not exists public.tournament_assistants (
  tournament_id  text not null references public.tournaments (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_assistants enable row level security;

drop policy if exists "assistants: read" on public.tournament_assistants;
create policy "assistants: read" on public.tournament_assistants
  for select using (user_id = auth.uid() or public.owns_tournament(tournament_id));
drop policy if exists "assistants: owner adds" on public.tournament_assistants;
create policy "assistants: owner adds" on public.tournament_assistants
  for insert with check (public.owns_tournament(tournament_id));
drop policy if exists "assistants: owner removes" on public.tournament_assistants;
create policy "assistants: owner removes" on public.tournament_assistants
  for delete using (public.owns_tournament(tournament_id));
grant select, insert, delete on public.tournament_assistants to authenticated;

-- The tournament state without what an assistant may change: match results and
-- the manual tie order that a new result resets.
create or replace function public.state_frame(s jsonb) returns jsonb
language sql immutable as $$
  select (s - 'matches' - 'groups') || jsonb_build_object('groups',
    coalesce((select jsonb_agg(g - 'manualOrder' order by i) from jsonb_array_elements(s -> 'groups') with ordinality as x(g, i)), '[]'::jsonb));
$$;

-- Assistants save results through this function. Only matches may change, and
-- each changed match keeps its players' slots unless the knockout draw moved a winner on.
create or replace function public.assistant_save_state(t text, new_state jsonb, new_status text) returns void
language plpgsql security definer set search_path = public as $$
declare cur public.tournaments;
begin
  if not exists (select 1 from public.tournament_assistants where tournament_id = t and user_id = auth.uid()) then
    raise exception 'permission denied';
  end if;
  select * into cur from public.tournaments where id = t for update;
  if not found then raise exception 'not found'; end if;
  if cur.status not in ('running', 'finished') then raise exception 'not running'; end if;
  if new_status not in ('running', 'finished') then raise exception 'bad status'; end if;
  if public.state_frame(cur.state) <> public.state_frame(new_state) then raise exception 'assistants can only enter results'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(cur.state -> 'matches') k)
     is distinct from (select array_agg(k order by k) from jsonb_object_keys(new_state -> 'matches') k) then
    raise exception 'assistants can only enter results';
  end if;
  update public.tournaments set state = new_state, status = new_status where id = t;
end;
$$;

revoke all on function public.assistant_save_state(text, jsonb, text) from public, anon;
grant execute on function public.assistant_save_state(text, jsonb, text) to authenticated;

-- Organizers pick assistants from everyone with an account (name and club only).
-- public_profiles already exposes that to signed-in users.

-------------------------------------------------------- admin overview

create or replace function public.admin_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'organizers', (select count(*) from public.profiles where is_organizer or role in ('organizer', 'admin')),
    'sellers', (select count(*) from public.profiles where is_seller),
    'trainers', (select count(*) from public.profiles where is_trainer),
    'tournaments', (select count(*) from public.tournaments),
    'running', (select count(*) from public.tournaments where status in ('registration', 'running')),
    'posts', (select count(*) from public.posts),
    'products', (select count(*) from public.products),
    'pendingProducts', (select count(*) from public.products where not approved),
    'pendingRoles', (select count(*) from public.role_requests where status = 'pending'),
    'orders', (select count(*) from public.orders),
    'bookings', (select count(*) from public.bookings where status = 'booked')
  ) end;
$$;
revoke all on function public.admin_counts() from public, anon;
grant execute on function public.admin_counts() to authenticated;
