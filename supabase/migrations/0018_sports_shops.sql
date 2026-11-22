-- Sports shops: a seller can open a shop page (name, logo, cover, city,
-- address, hours, phone, WhatsApp) and give Pingo players a promotion.
--
-- * One shop per seller account (owner_id = the seller). Products stay in
--   public.products and still need the admin's approval; the shop page shows
--   the approved products of its owner.
-- * The promotion: a title and details, an optional discount in percent that
--   Pingo applies by itself to orders placed in the app, an optional code to
--   use in the shop, and an optional end date.
-- * The promotion code is for signed-in players only: visitors (anon) cannot
--   read the promo_code column.
-- * The admin can hide a shop or feature it; the owner cannot change those.
-- Safe to run again.

create table if not exists public.shops (
  owner_id      uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  tagline       text check (tagline is null or char_length(tagline) <= 120),
  about         text check (about is null or char_length(about) <= 1200),
  logo_url      text,
  cover_url     text,
  city          text check (city is null or char_length(city) <= 60),
  address       text check (address is null or char_length(address) <= 200),
  map_url       text check (map_url is null or map_url ~* '^https?://'),
  hours         text check (hours is null or char_length(hours) <= 120),
  phone         text check (phone is null or char_length(phone) <= 30),
  whatsapp      text check (whatsapp is null or char_length(whatsapp) <= 30),
  promo_title   text check (promo_title is null or char_length(promo_title) <= 80),
  promo_details text check (promo_details is null or char_length(promo_details) <= 600),
  promo_pct     int  check (promo_pct is null or promo_pct between 1 and 90),
  promo_code    text check (promo_code is null or char_length(promo_code) <= 30),
  promo_until   date,
  active        boolean not null default true,
  hidden        boolean not null default false,
  featured      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shops_city_idx on public.shops (city);

alter table public.shops enable row level security;

drop policy if exists "shops: read open" on public.shops;
create policy "shops: read open" on public.shops
  for select using ((active and not hidden) or owner_id = auth.uid() or public.is_admin());

drop policy if exists "shops: sellers open" on public.shops;
create policy "shops: sellers open" on public.shops
  for insert with check (public.is_seller() and owner_id = auth.uid() and not hidden and not featured);

drop policy if exists "shops: owner or admin edit" on public.shops;
create policy "shops: owner or admin edit" on public.shops
  for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "shops: owner or admin delete" on public.shops;
create policy "shops: owner or admin delete" on public.shops
  for delete using (owner_id = auth.uid() or public.is_admin());

-- Only an admin hides or features a shop. updated_at follows every change.
create or replace function public.guard_shop() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.hidden is distinct from old.hidden or new.featured is distinct from old.featured) then
    raise exception 'only an admin can hide or feature a shop';
  end if;
  new.owner_id := old.owner_id;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shops_guard on public.shops;
create trigger shops_guard before update on public.shops for each row execute function public.guard_shop();

-- Visitors read everything but the promotion code; signed-in players read it all.
revoke all on public.shops from anon, authenticated;
grant select (owner_id, name, tagline, about, logo_url, cover_url, city, address, map_url, hours, phone, whatsapp,
              promo_title, promo_details, promo_pct, promo_until, active, hidden, featured, created_at, updated_at)
  on public.shops to anon;
grant select on public.shops to authenticated;
grant insert (name, tagline, about, logo_url, cover_url, city, address, map_url, hours, phone, whatsapp,
              promo_title, promo_details, promo_pct, promo_code, promo_until, active)
  on public.shops to authenticated;
grant update (name, tagline, about, logo_url, cover_url, city, address, map_url, hours, phone, whatsapp,
              promo_title, promo_details, promo_pct, promo_code, promo_until, active, hidden, featured)
  on public.shops to authenticated;
grant delete on public.shops to authenticated;
grant all on public.shops to service_role;

-- The discount (percent) a seller's shop gives Pingo players today, 0 if none.
create or replace function public.shop_discount(seller uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select s.promo_pct from public.shops s
    where s.owner_id = seller and s.active and not s.hidden
      and (s.promo_until is null or s.promo_until >= (now() at time zone 'Africa/Cairo')::date)), 0);
$$;
grant execute on function public.shop_discount(uuid) to anon, authenticated;

------------------------------------------------- orders: Pingo discount

alter table public.orders add column if not exists promo_pct int not null default 0;

-- Every new order gets the shop's Pingo discount on its total. A trigger (not a
-- new place_order) so it keeps working whatever else changes place_order.
create or replace function public.apply_shop_discount() returns trigger
language plpgsql security definer set search_path = public as $$
declare pct int;
begin
  pct := public.shop_discount(new.seller_id);
  new.promo_pct := pct;
  if pct > 0 then new.total := round(new.total * (100 - pct) / 100.0, 2); end if;
  return new;
end;
$$;

drop trigger if exists orders_shop_discount on public.orders;
create trigger orders_shop_discount before insert on public.orders for each row execute function public.apply_shop_discount();
