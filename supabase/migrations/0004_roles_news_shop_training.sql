-- Pingo phase 3: several roles per account, role requests, news, shop and training.
-- Run once in the Supabase SQL Editor after 0001–0003. Safe to run again.

----------------------------------------------------------------- roles

-- One account can be organizer, seller and trainer at the same time.
-- `role` keeps 'admin' (and old 'organizer' values keep working).
alter table public.profiles add column if not exists is_organizer boolean not null default false;
alter table public.profiles add column if not exists is_seller    boolean not null default false;
alter table public.profiles add column if not exists is_trainer   boolean not null default false;
alter table public.profiles add column if not exists bio          text check (bio is null or char_length(bio) <= 600);

update public.profiles set is_organizer = true where role in ('organizer', 'admin') and not is_organizer;

create or replace function public.is_organizer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role in ('organizer', 'admin') or is_organizer));
$$;

create or replace function public.is_seller() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or is_seller));
$$;

create or replace function public.is_trainer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or is_trainer));
$$;

-- Only an admin may change roles (blocks self-promotion).
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       new.role is distinct from old.role
    or new.is_organizer is distinct from old.is_organizer
    or new.is_seller is distinct from old.is_seller
    or new.is_trainer is distinct from old.is_trainer) then
    raise exception 'only an admin can change roles';
  end if;
  return new;
end;
$$;

grant update (full_name, phone, birth_year, club, role, is_organizer, is_seller, is_trainer, bio) on public.profiles to authenticated;

-- Requests to become organizer, seller or trainer; an admin decides.
create table if not exists public.role_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  role        text not null check (role in ('organizer', 'seller', 'trainer')),
  note        text check (note is null or char_length(note) <= 400),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (user_id, role)
);
alter table public.role_requests enable row level security;

drop policy if exists "role_requests: own or admin" on public.role_requests;
create policy "role_requests: own or admin" on public.role_requests
  for select using (user_id = auth.uid() or public.is_admin());
grant select on public.role_requests to authenticated;

create or replace function public.request_role(r text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if r not in ('organizer', 'seller', 'trainer') then raise exception 'bad role'; end if;
  insert into public.role_requests (user_id, role, note) values (auth.uid(), r, nullif(trim(note), ''))
  on conflict (user_id, role) do update set status = 'pending', note = excluded.note, created_at = now(), decided_at = null
    where public.role_requests.status = 'rejected';
end;
$$;

create or replace function public.decide_role_request(req uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare rr public.role_requests;
begin
  if not public.is_admin() then raise exception 'only an admin can change roles'; end if;
  update public.role_requests set status = case when approve then 'approved' else 'rejected' end, decided_at = now()
    where id = req returning * into rr;
  if not found then raise exception 'not found'; end if;
  if approve then
    update public.profiles set
      is_organizer = is_organizer or rr.role = 'organizer',
      is_seller    = is_seller    or rr.role = 'seller',
      is_trainer   = is_trainer   or rr.role = 'trainer'
    where id = rr.user_id;
  end if;
end;
$$;

revoke all on function public.request_role(text, text) from public, anon;
revoke all on function public.decide_role_request(uuid, boolean) from public, anon;
grant execute on function public.request_role(text, text) to authenticated;
grant execute on function public.decide_role_request(uuid, boolean) to authenticated;
grant execute on function public.is_seller() to anon, authenticated;
grant execute on function public.is_trainer() to anon, authenticated;

-- Sign-up can ask for roles: metadata "wants" = 'organizer,seller,trainer'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare w text;
begin
  insert into public.profiles (id, full_name, phone, birth_year, club)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'birth_year', ''), '[^0-9]', '', 'g'), '')::int,
    nullif(new.raw_user_meta_data ->> 'club', '')
  );
  foreach w in array string_to_array(coalesce(new.raw_user_meta_data ->> 'wants', ''), ',') loop
    if trim(w) in ('organizer', 'seller', 'trainer') then
      insert into public.role_requests (user_id, role) values (new.id, trim(w)) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;

-- Public card for people who sell, train or write: name, club, bio, roles. Never phone.
create or replace view public.public_profiles
with (security_invoker = false) as
  select id, full_name, club, bio, is_seller or role = 'admin' as is_seller, is_trainer as is_trainer
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

------------------------------------------------------------------ news

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 160),
  summary     text check (summary is null or char_length(summary) <= 300),
  body        text not null default '' check (char_length(body) <= 20000),
  category    text not null default 'news' check (category in ('news', 'learn', 'tips', 'events', 'gear', 'other')),
  cover_url   text check (cover_url is null or char_length(cover_url) <= 500),
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();

alter table public.posts enable row level security;

drop policy if exists "posts: read published" on public.posts;
create policy "posts: read published" on public.posts
  for select using (published or author_id = auth.uid() or public.is_admin());

-- Admins and organizers write news.
drop policy if exists "posts: writers add" on public.posts;
create policy "posts: writers add" on public.posts
  for insert with check (public.is_organizer() and author_id = auth.uid());

drop policy if exists "posts: author or admin edit" on public.posts;
create policy "posts: author or admin edit" on public.posts
  for update using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());

drop policy if exists "posts: author or admin delete" on public.posts;
create policy "posts: author or admin delete" on public.posts
  for delete using (author_id = auth.uid() or public.is_admin());

grant select on public.posts to anon, authenticated;
grant insert, delete on public.posts to authenticated;
grant update (title, summary, body, category, cover_url, published) on public.posts to authenticated;

------------------------------------------------------------------ shop

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  description  text check (description is null or char_length(description) <= 3000),
  category     text not null default 'other' check (category in ('rackets', 'rubbers', 'balls', 'tables', 'clothing', 'shoes', 'bags', 'accessories', 'other')),
  price        numeric(10, 2) not null check (price >= 0),
  stock        int not null default 1 check (stock >= 0),
  image_url    text check (image_url is null or char_length(image_url) <= 500),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists products_created_idx on public.products (created_at desc);

alter table public.products enable row level security;

drop policy if exists "products: read active" on public.products;
create policy "products: read active" on public.products
  for select using (active or seller_id = auth.uid() or public.is_admin());

drop policy if exists "products: sellers add" on public.products;
create policy "products: sellers add" on public.products
  for insert with check (public.is_seller() and seller_id = auth.uid());

drop policy if exists "products: owner or admin edit" on public.products;
create policy "products: owner or admin edit" on public.products
  for update using (seller_id = auth.uid() or public.is_admin()) with check (seller_id = auth.uid() or public.is_admin());

drop policy if exists "products: owner or admin delete" on public.products;
create policy "products: owner or admin delete" on public.products
  for delete using (seller_id = auth.uid() or public.is_admin());

grant select on public.products to anon, authenticated;
grant insert, delete on public.products to authenticated;
grant update (name, description, category, price, stock, image_url, active) on public.products to authenticated;

-- Order requests: no online payment. The buyer pays the seller on delivery or pickup.
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references public.products (id) on delete set null,
  product_name text not null,
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  buyer_id    uuid not null references public.profiles (id) on delete cascade,
  qty         int not null check (qty between 1 and 99),
  total       numeric(10, 2) not null,
  phone       text check (phone is null or char_length(phone) <= 30),
  note        text check (note is null or char_length(note) <= 400),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'delivered', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.orders enable row level security;

drop policy if exists "orders: buyer seller admin" on public.orders;
create policy "orders: buyer seller admin" on public.orders
  for select using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin());
grant select on public.orders to authenticated;

create or replace function public.place_order(p uuid, q int, phone text, note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare prod public.products; oid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if q is null or q < 1 or q > 99 then raise exception 'bad quantity'; end if;
  select * into prod from public.products where id = p for update;
  if not found or not prod.active then raise exception 'product unavailable'; end if;
  if prod.stock < q then raise exception 'out of stock'; end if;
  if prod.seller_id = auth.uid() then raise exception 'own product'; end if;
  update public.products set stock = stock - q where id = p;
  insert into public.orders (product_id, product_name, seller_id, buyer_id, qty, total, phone, note)
  values (p, prod.name, prod.seller_id, auth.uid(), q, prod.price * q, nullif(trim(phone), ''), nullif(trim(note), ''))
  returning id into oid;
  return oid;
end;
$$;

-- Seller: pending → confirmed → delivered, or cancelled. Buyer: may cancel while pending.
create or replace function public.set_order_status(o uuid, s text) returns void
language plpgsql security definer set search_path = public as $$
declare ord public.orders;
begin
  select * into ord from public.orders where id = o for update;
  if not found then raise exception 'not found'; end if;
  if s not in ('confirmed', 'delivered', 'cancelled') then raise exception 'bad status'; end if;
  if ord.status in ('delivered', 'cancelled') then raise exception 'order closed'; end if;
  if not (ord.seller_id = auth.uid() or public.is_admin()
          or (ord.buyer_id = auth.uid() and s = 'cancelled' and ord.status = 'pending')) then
    raise exception 'permission denied';
  end if;
  update public.orders set status = s, updated_at = now() where id = o;
  if s = 'cancelled' and ord.product_id is not null then
    update public.products set stock = stock + ord.qty where id = ord.product_id;
  end if;
end;
$$;

revoke all on function public.place_order(uuid, int, text, text) from public, anon;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.place_order(uuid, int, text, text) to authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-------------------------------------------------------------- training

create table if not exists public.training_locations (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  address     text check (address is null or char_length(address) <= 300),
  map_url     text check (map_url is null or char_length(map_url) <= 500),
  created_at  timestamptz not null default now()
);
alter table public.training_locations enable row level security;

drop policy if exists "locations: public read" on public.training_locations;
create policy "locations: public read" on public.training_locations for select using (true);
drop policy if exists "locations: trainer writes" on public.training_locations;
create policy "locations: trainer writes" on public.training_locations
  for insert with check (public.is_trainer() and trainer_id = auth.uid());
drop policy if exists "locations: owner edits" on public.training_locations;
create policy "locations: owner edits" on public.training_locations
  for update using (trainer_id = auth.uid() or public.is_admin()) with check (trainer_id = auth.uid() or public.is_admin());
drop policy if exists "locations: owner deletes" on public.training_locations;
create policy "locations: owner deletes" on public.training_locations
  for delete using (trainer_id = auth.uid() or public.is_admin());

grant select on public.training_locations to anon, authenticated;
grant insert, delete on public.training_locations to authenticated;
grant update (name, address, map_url) on public.training_locations to authenticated;

-- One-hour slots. `booked` is maintained only by book_slot / cancel_booking.
create table if not exists public.training_slots (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  location_id  uuid not null references public.training_locations (id) on delete cascade,
  starts_at    timestamptz not null,
  price        numeric(10, 2) not null default 0 check (price >= 0),
  note         text check (note is null or char_length(note) <= 200),
  booked       boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (trainer_id, starts_at)
);
create index if not exists slots_time_idx on public.training_slots (starts_at);
alter table public.training_slots enable row level security;

drop policy if exists "slots: public read" on public.training_slots;
create policy "slots: public read" on public.training_slots for select using (true);
drop policy if exists "slots: trainer adds" on public.training_slots;
create policy "slots: trainer adds" on public.training_slots
  for insert with check (public.is_trainer() and trainer_id = auth.uid() and not booked
    and exists (select 1 from public.training_locations l where l.id = location_id and l.trainer_id = auth.uid()));
drop policy if exists "slots: owner edits" on public.training_slots;
create policy "slots: owner edits" on public.training_slots
  for update using (trainer_id = auth.uid() or public.is_admin()) with check (trainer_id = auth.uid() or public.is_admin());
drop policy if exists "slots: owner deletes free slots" on public.training_slots;
create policy "slots: owner deletes free slots" on public.training_slots
  for delete using ((trainer_id = auth.uid() or public.is_admin()) and not booked);

grant select on public.training_slots to anon, authenticated;
grant insert, delete on public.training_slots to authenticated;
grant update (price, note) on public.training_slots to authenticated;

create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references public.training_slots (id) on delete cascade,
  trainer_id  uuid not null references public.profiles (id) on delete cascade,
  player_id   uuid not null references public.profiles (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 300),
  status      text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at  timestamptz not null default now()
);
create unique index if not exists bookings_one_per_slot on public.bookings (slot_id) where status = 'booked';
alter table public.bookings enable row level security;

drop policy if exists "bookings: player trainer admin" on public.bookings;
create policy "bookings: player trainer admin" on public.bookings
  for select using (player_id = auth.uid() or trainer_id = auth.uid() or public.is_admin());
grant select on public.bookings to authenticated;

create or replace function public.book_slot(s uuid, note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sl public.training_slots; bid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into sl from public.training_slots where id = s for update;
  if not found then raise exception 'not found'; end if;
  if sl.booked then raise exception 'slot taken'; end if;
  if sl.starts_at < now() then raise exception 'slot passed'; end if;
  if sl.trainer_id = auth.uid() then raise exception 'own slot'; end if;
  update public.training_slots set booked = true where id = s;
  insert into public.bookings (slot_id, trainer_id, player_id, note)
  values (s, sl.trainer_id, auth.uid(), nullif(trim(note), '')) returning id into bid;
  return bid;
end;
$$;

-- Player or trainer cancels; the slot opens again.
create or replace function public.cancel_booking(b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  select * into bk from public.bookings where id = b for update;
  if not found or bk.status <> 'booked' then raise exception 'not found'; end if;
  if not (bk.player_id = auth.uid() or bk.trainer_id = auth.uid() or public.is_admin()) then raise exception 'permission denied'; end if;
  update public.bookings set status = 'cancelled' where id = b;
  update public.training_slots set booked = false where id = bk.slot_id;
end;
$$;

revoke all on function public.book_slot(uuid, text) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.book_slot(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- Trainers see who booked their slots (name and phone of their own trainees only).
create or replace function public.my_trainees() returns table (booking_id uuid, full_name text, phone text)
language sql stable security definer set search_path = public as $$
  select b.id, p.full_name, p.phone from public.bookings b join public.profiles p on p.id = b.player_id
  where b.trainer_id = auth.uid() and b.status = 'booked';
$$;
-- Sellers see their buyers' names the same way.
create or replace function public.my_buyers() returns table (order_id uuid, full_name text, phone text)
language sql stable security definer set search_path = public as $$
  select o.id, p.full_name, coalesce(o.phone, p.phone) from public.orders o join public.profiles p on p.id = o.buyer_id
  where o.seller_id = auth.uid() or public.is_admin();
$$;
revoke all on function public.my_trainees() from public, anon;
revoke all on function public.my_buyers() from public, anon;
grant execute on function public.my_trainees() to authenticated;
grant execute on function public.my_buyers() to authenticated;
