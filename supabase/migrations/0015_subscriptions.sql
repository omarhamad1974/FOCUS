-- Pingo 0015: subscriptions for organizers, trainers and sellers (Omar's revenue plan, 2026-11-22).
-- * Players are free.
-- * Organizers and trainers pay monthly, or yearly at a discount.
-- * Sellers pay per active product per month (up to a maximum number of products),
--   or buy the unlimited package.
-- * Every price is an admin setting (plan_settings, one row). Defaults are Omar's.
-- * Payments are offline. The admin records each period (plan, start, end, amount) and ticks
--   "paid". A paid period moves the person's expiry date. An unpaid period is an amount due.
-- * Nothing is blocked when a subscription expires (Omar chose "warnings only"): the app shows
--   the status, expiry date and amount due to the person and to the admin.
-- Safe to run more than once.

------------------------------------------------------------------ prices

create table if not exists public.plan_settings (
  id                   boolean primary key default true check (id),
  org_month            numeric(10, 2) not null default 500  check (org_month >= 0),
  org_year             numeric(10, 2) not null default 5000 check (org_year >= 0),
  trainer_month        numeric(10, 2) not null default 500  check (trainer_month >= 0),
  trainer_year         numeric(10, 2) not null default 5000 check (trainer_year >= 0),
  seller_per_product   numeric(10, 2) not null default 20   check (seller_per_product >= 0),
  seller_max_products  int            not null default 20   check (seller_max_products >= 1),
  seller_unlimited     numeric(10, 2) not null default 500  check (seller_unlimited >= 0),
  updated_at           timestamptz    not null default now()
);
insert into public.plan_settings (id) values (true) on conflict (id) do nothing;

alter table public.plan_settings enable row level security;

-- Prices are public (a role page can show them to anyone); only an admin changes them.
drop policy if exists "plan_settings: read" on public.plan_settings;
create policy "plan_settings: read" on public.plan_settings for select using (true);
drop policy if exists "plan_settings: admin edits" on public.plan_settings;
create policy "plan_settings: admin edits" on public.plan_settings
  for update using (public.is_admin()) with check (public.is_admin());

revoke all on public.plan_settings from anon, authenticated;
grant select on public.plan_settings to anon, authenticated;
grant update (org_month, org_year, trainer_month, trainer_year, seller_per_product,
  seller_max_products, seller_unlimited, updated_at) on public.plan_settings to authenticated;
grant all on public.plan_settings to service_role;

----------------------------------------------------------- subscriptions

create table if not exists public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('organizer', 'trainer', 'seller')),
  plan        text not null check (plan in ('monthly', 'yearly', 'per_product', 'unlimited')),
  -- per_product plan only: how many products the seller pays for.
  products    int check (products is null or products >= 1),
  amount      numeric(10, 2) not null default 0 check (amount >= 0),
  starts_on   date not null,
  ends_on     date not null,
  paid        boolean not null default false,
  paid_at     timestamptz,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((role = 'seller') = (plan in ('per_product', 'unlimited'))),
  check ((plan = 'per_product') = (products is not null))
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, role, ends_on desc);

alter table public.subscriptions enable row level security;

-- Each person sees their own periods; the admin sees and records everyone's.
drop policy if exists "subscriptions: own or admin read" on public.subscriptions;
create policy "subscriptions: own or admin read" on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "subscriptions: admin adds" on public.subscriptions;
create policy "subscriptions: admin adds" on public.subscriptions
  for insert with check (public.is_admin());
drop policy if exists "subscriptions: admin edits" on public.subscriptions;
create policy "subscriptions: admin edits" on public.subscriptions
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "subscriptions: admin deletes" on public.subscriptions;
create policy "subscriptions: admin deletes" on public.subscriptions
  for delete using (public.is_admin());

revoke all on public.subscriptions from anon, authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

-- Keep paid_at in step with the paid tick, and record who entered the period.
create or replace function public.subscription_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.paid_at := case when new.paid then coalesce(new.paid_at, now()) end;
  elsif new.paid is distinct from old.paid then
    new.paid_at := case when new.paid then now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_stamp on public.subscriptions;
create trigger subscriptions_stamp before insert or update on public.subscriptions
  for each row execute function public.subscription_stamp();
