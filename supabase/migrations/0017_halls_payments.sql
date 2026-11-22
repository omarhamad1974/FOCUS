-- Pingo 0017: table tennis halls with bookable table slots, and payment methods for every provider
-- (Omar, 2026-11-22). Safe to run more than once.
--
-- * New role "hall" (hall owner), approved by the admin like organizer / trainer / seller.
--   A hall has a number of tables and one price per hour for all tables. The owner opens one-hour
--   slots per table; players request as many slots as they like.
-- * Several players may request the same free slot. The owner confirms one (the others are turned
--   down). Priority goes to players who paid: approving a payment confirms the booking straight away.
-- * Every provider (organizer, trainer, seller, hall owner) sets payment methods in pay_settings:
--   wallet / InstaPay / Fawry / other (numbers to pay to; the payer uploads a receipt to review)
--   and/or cash on the spot, plus a WhatsApp number. Organizers and hall owners set how many hours
--   before the start a player may still withdraw or cancel.
-- * payments: one row per thing paid for (tournament entry, training session, hall booking, order).
--   The provider approves (with or without a receipt) or rejects. Approving ticks the existing
--   "paid" flag (registrations.paid is new; bookings.paid, orders.paid from 0012).
-- * Receipts live in the private storage bucket "receipts" (payer and provider can read them).
-- * Hall owners subscribe like trainers (plan_settings.hall_month / hall_year).

------------------------------------------------------------------ role

alter table public.profiles add column if not exists is_hall boolean not null default false;

create or replace function public.is_hall() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or is_hall));
$$;
grant execute on function public.is_hall() to anon, authenticated;

-- Same as 0004 plus is_hall.
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       new.role is distinct from old.role
    or new.is_organizer is distinct from old.is_organizer
    or new.is_seller is distinct from old.is_seller
    or new.is_trainer is distinct from old.is_trainer
    or new.is_hall is distinct from old.is_hall) then
    raise exception 'only an admin can change roles';
  end if;
  return new;
end;
$$;
grant update (is_hall) on public.profiles to authenticated;

alter table public.role_requests drop constraint if exists role_requests_role_check;
alter table public.role_requests add constraint role_requests_role_check
  check (role in ('organizer', 'seller', 'trainer', 'hall'));

create or replace function public.request_role(r text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if r not in ('organizer', 'seller', 'trainer', 'hall') then raise exception 'bad role'; end if;
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
      is_trainer   = is_trainer   or rr.role = 'trainer',
      is_hall      = is_hall      or rr.role = 'hall'
    where id = rr.user_id;
  end if;
end;
$$;

-- Same as 0007, plus "hall" among the roles a sign-up can ask for.
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
    if trim(w) in ('organizer', 'seller', 'trainer', 'hall') then
      insert into public.role_requests (user_id, role) values (new.id, trim(w)) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;

-- Same as 0013 plus is_hall at the end (never phone).
create or replace view public.public_profiles
with (security_invoker = false) as
  select id, full_name, club, bio, is_seller or role = 'admin' as is_seller, is_trainer as is_trainer, avatar_url, gender,
    (coalesce(is_organizer, false) or role in ('organizer', 'admin')) as is_organizer,
    is_hall
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

----------------------------------------------------------- subscriptions

alter table public.plan_settings add column if not exists hall_month numeric(10, 2) not null default 500 check (hall_month >= 0);
alter table public.plan_settings add column if not exists hall_year  numeric(10, 2) not null default 5000 check (hall_year >= 0);
grant update (hall_month, hall_year) on public.plan_settings to authenticated;

alter table public.subscriptions drop constraint if exists subscriptions_role_check;
alter table public.subscriptions add constraint subscriptions_role_check
  check (role in ('organizer', 'trainer', 'seller', 'hall'));

------------------------------------------------------- payment settings

-- What a provider shows payers: methods, numbers to pay to, WhatsApp, and the cancel deadline.
-- Public on purpose: players need these numbers to pay.
create table if not exists public.pay_settings (
  user_id       uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  accepts_cash  boolean not null default true,
  accepts_wallet boolean not null default false,
  -- [{ "kind": "vodafone" | "instapay" | "fawry" | "etisalat" | "orange" | "we" | "other", "number": "010…", "label": "…" }]
  wallets       jsonb not null default '[]'::jsonb check (jsonb_typeof(wallets) = 'array' and jsonb_array_length(wallets) <= 8),
  whatsapp      text check (whatsapp is null or char_length(whatsapp) <= 20),
  note          text check (note is null or char_length(note) <= 300),
  -- Organizer / hall owner: a player may withdraw or cancel until this many hours before the start. Null = any time.
  cancel_hours  int check (cancel_hours is null or cancel_hours between 0 and 720),
  updated_at    timestamptz not null default now()
);
alter table public.pay_settings enable row level security;

drop policy if exists "pay_settings: public read" on public.pay_settings;
create policy "pay_settings: public read" on public.pay_settings for select using (true);
drop policy if exists "pay_settings: own insert" on public.pay_settings;
create policy "pay_settings: own insert" on public.pay_settings for insert with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "pay_settings: own update" on public.pay_settings;
create policy "pay_settings: own update" on public.pay_settings
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

revoke all on public.pay_settings from anon, authenticated;
grant select on public.pay_settings to anon, authenticated;
grant insert, update on public.pay_settings to authenticated;
grant all on public.pay_settings to service_role;

------------------------------------------------------------------ halls

create table if not exists public.halls (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  address     text check (address is null or char_length(address) <= 200),
  map_url     text check (map_url is null or char_length(map_url) <= 500),
  photo_url   text,
  tables      int not null default 4 check (tables between 1 and 40),
  price_hour  numeric(10, 2) not null default 0 check (price_hour >= 0),
  note        text check (note is null or char_length(note) <= 400),
  created_at  timestamptz not null default now()
);
alter table public.halls enable row level security;
drop policy if exists "halls: public read" on public.halls;
create policy "halls: public read" on public.halls for select using (true);
drop policy if exists "halls: owner adds" on public.halls;
create policy "halls: owner adds" on public.halls for insert with check (public.is_hall() and owner_id = auth.uid());
drop policy if exists "halls: owner edits" on public.halls;
create policy "halls: owner edits" on public.halls
  for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "halls: owner deletes" on public.halls;
create policy "halls: owner deletes" on public.halls for delete using (owner_id = auth.uid() or public.is_admin());
revoke all on public.halls from anon, authenticated;
grant select on public.halls to anon, authenticated;
grant insert, update, delete on public.halls to authenticated;
grant all on public.halls to service_role;

-- One hour on one table. `taken` is set only by a confirmed booking (functions below).
create table if not exists public.hall_slots (
  id          uuid primary key default gen_random_uuid(),
  hall_id     uuid not null references public.halls (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  table_no    int not null check (table_no between 1 and 40),
  starts_at   timestamptz not null,
  taken       boolean not null default false,
  unique (hall_id, table_no, starts_at)
);
create index if not exists hall_slots_time_idx on public.hall_slots (hall_id, starts_at);
alter table public.hall_slots enable row level security;
drop policy if exists "hall_slots: public read" on public.hall_slots;
create policy "hall_slots: public read" on public.hall_slots for select using (true);
drop policy if exists "hall_slots: owner adds" on public.hall_slots;
create policy "hall_slots: owner adds" on public.hall_slots
  for insert with check (owner_id = auth.uid() and not taken
    and exists (select 1 from public.halls h where h.id = hall_id and h.owner_id = auth.uid() and table_no <= h.tables));
drop policy if exists "hall_slots: owner deletes free" on public.hall_slots;
create policy "hall_slots: owner deletes free" on public.hall_slots
  for delete using ((owner_id = auth.uid() or public.is_admin()) and not taken);
revoke all on public.hall_slots from anon, authenticated;
grant select on public.hall_slots to anon, authenticated;
grant insert, delete on public.hall_slots to authenticated;
grant all on public.hall_slots to service_role;

create table if not exists public.hall_bookings (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references public.hall_slots (id) on delete cascade,
  hall_id     uuid not null references public.halls (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  player_id   uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(10, 2) not null default 0,
  status      text not null default 'requested' check (status in ('requested', 'confirmed', 'rejected', 'cancelled')),
  paid        boolean not null default false,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (slot_id, player_id)
);
create unique index if not exists hall_bookings_one_confirmed on public.hall_bookings (slot_id) where status = 'confirmed';
alter table public.hall_bookings enable row level security;
drop policy if exists "hall_bookings: player owner admin" on public.hall_bookings;
create policy "hall_bookings: player owner admin" on public.hall_bookings
  for select using (player_id = auth.uid() or owner_id = auth.uid() or public.is_admin());
revoke all on public.hall_bookings from anon, authenticated;
grant select on public.hall_bookings to authenticated;
grant all on public.hall_bookings to service_role;

-- How many open requests each free slot has (players see "others asked too", never who).
create or replace function public.hall_slot_requests(h uuid) returns table (slot_id uuid, requests int)
language sql stable security definer set search_path = public as $$
  select b.slot_id, count(*)::int from public.hall_bookings b
  where b.hall_id = h and b.status = 'requested' group by b.slot_id;
$$;

-- Player asks for one or more slots. Skips taken or past slots and the owner's own hall. Returns how many.
create or replace function public.book_hall_slots(slots uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare sl record; n int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  for sl in select s.*, h.price_hour from public.hall_slots s join public.halls h on h.id = s.hall_id
      where s.id = any(coalesce(slots, '{}')) and not s.taken and s.starts_at > now() and s.owner_id <> auth.uid() loop
    insert into public.hall_bookings (slot_id, hall_id, owner_id, player_id, amount)
    values (sl.id, sl.hall_id, sl.owner_id, auth.uid(), sl.price_hour)
    on conflict (slot_id, player_id) do update set status = 'requested', created_at = now(), decided_at = null, amount = excluded.amount
      where public.hall_bookings.status in ('cancelled', 'rejected');
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- Start of the slot / tournament minus the provider's cancel_hours. Null when there is no limit.
create or replace function public.cancel_deadline(provider uuid, starts timestamptz) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when ps.cancel_hours is null or starts is null then null
    else starts - make_interval(hours => ps.cancel_hours) end
  from (select (select cancel_hours from public.pay_settings where user_id = provider) as cancel_hours) ps;
$$;

-- Owner confirms (the other requests for that hour are turned down) or turns down a request.
create or replace function public.decide_hall_booking(b uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare bk public.hall_bookings;
begin
  select * into bk from public.hall_bookings where id = b for update;
  if not found then raise exception 'not found'; end if;
  if not (bk.owner_id = auth.uid() or public.is_admin()) then raise exception 'permission denied'; end if;
  if approve then
    if exists (select 1 from public.hall_bookings where slot_id = bk.slot_id and status = 'confirmed' and id <> b) then
      raise exception 'slot taken';
    end if;
    update public.hall_bookings set status = 'confirmed', decided_at = now() where id = b;
    update public.hall_bookings set status = 'rejected', decided_at = now()
      where slot_id = bk.slot_id and id <> b and status = 'requested';
    update public.payments set status = 'rejected', decided_at = now()
      where kind = 'hall' and status = 'pending'
        and ref in (select id::text from public.hall_bookings where slot_id = bk.slot_id and id <> b);
    update public.hall_slots set taken = true where id = bk.slot_id;
  else
    update public.hall_bookings set status = 'rejected', decided_at = now() where id = b;
    if bk.status = 'confirmed' then update public.hall_slots set taken = false where id = bk.slot_id; end if;
  end if;
end;
$$;

-- Player cancels (until the owner's deadline) or owner cancels (any time). The hour opens again.
create or replace function public.cancel_hall_booking(b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bk public.hall_bookings; st timestamptz; dl timestamptz;
begin
  select * into bk from public.hall_bookings where id = b for update;
  if not found or bk.status not in ('requested', 'confirmed') then raise exception 'not found'; end if;
  if not (bk.player_id = auth.uid() or bk.owner_id = auth.uid() or public.is_admin()) then raise exception 'permission denied'; end if;
  select starts_at into st from public.hall_slots where id = bk.slot_id;
  if bk.player_id = auth.uid() and bk.owner_id <> auth.uid() and not public.is_admin() then
    dl := public.cancel_deadline(bk.owner_id, st);
    if bk.status = 'confirmed' and dl is not null and now() > dl then raise exception 'cancel deadline passed'; end if;
  end if;
  update public.hall_bookings set status = 'cancelled', decided_at = now() where id = b;
  if bk.status = 'confirmed' then update public.hall_slots set taken = false where id = bk.slot_id; end if;
end;
$$;

-- Owner: names and phones of the people who asked for their hours.
create or replace function public.my_hall_players() returns table (booking_id uuid, full_name text, phone text)
language sql stable security definer set search_path = public as $$
  select b.id, p.full_name, p.phone from public.hall_bookings b join public.profiles p on p.id = b.player_id
  where b.owner_id = auth.uid() or public.is_admin();
$$;

---------------------------------------------------------- registrations

alter table public.registrations add column if not exists paid boolean not null default false;

-- Withdrawing: as before (registration open), and not after the organizer's deadline.
create or replace function public.withdraw_from_tournament(t text) returns void
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; dl timestamptz;
begin
  select * into tour from public.tournaments where id = t;
  if not found then return; end if;
  dl := public.cancel_deadline(tour.organizer_id,
    case when tour.date is null then null
      else ((tour.date::text || ' ' || coalesce(nullif(tour.state ->> 'time', ''), '00:00'))::timestamp at time zone 'Africa/Cairo') end);
  if dl is not null and now() > dl then raise exception 'cancel deadline passed'; end if;
  update public.registrations set status = 'withdrawn', decided_at = now()
  where tournament_id = t and player_id = auth.uid() and status in ('pending', 'approved')
    and tour.status = 'registration';
end;
$$;

--------------------------------------------------------------- payments

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('tournament', 'training', 'hall', 'order')),
  -- registrations.id / bookings.id / hall_bookings.id / orders.id
  ref          text not null,
  provider_id  uuid not null references public.profiles (id) on delete cascade,
  payer_id     uuid not null references public.profiles (id) on delete cascade,
  amount       numeric(10, 2) not null default 0,
  method       text not null check (method in ('wallet', 'cash')),
  wallet_kind  text check (wallet_kind is null or char_length(wallet_kind) <= 20),
  -- Path in the private "receipts" bucket, or 'demo' for simulated receipts.
  receipt_path text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note         text check (note is null or char_length(note) <= 300),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  unique (kind, ref)
);
create index if not exists payments_provider_idx on public.payments (provider_id, status);
alter table public.payments enable row level security;
drop policy if exists "payments: payer provider admin" on public.payments;
create policy "payments: payer provider admin" on public.payments
  for select using (payer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
grant all on public.payments to service_role;

-- Who provides `ref` of `kind`, who pays, and how much. Raises when unknown.
create or replace function public.pay_target(k text, r text, out provider uuid, out payer uuid, out amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if k = 'tournament' then
    select t.organizer_id, g.player_id, coalesce(nullif(t.state ->> 'fee', '')::numeric, 0)
      into provider, payer, amount
      from public.registrations g join public.tournaments t on t.id = g.tournament_id where g.id::text = r;
  elsif k = 'training' then
    select b.trainer_id, b.player_id, s.price into provider, payer, amount
      from public.bookings b join public.training_slots s on s.id = b.slot_id where b.id::text = r;
  elsif k = 'hall' then
    select b.owner_id, b.player_id, b.amount into provider, payer, amount from public.hall_bookings b where b.id::text = r;
  elsif k = 'order' then
    select o.seller_id, o.buyer_id, o.total into provider, payer, amount from public.orders o where o.id::text = r;
  else
    raise exception 'bad kind';
  end if;
  if provider is null then raise exception 'not found'; end if;
end;
$$;

-- Tick or untick "paid" on the thing itself (no checks; called by the functions below).
create or replace function public.apply_paid(k text, r text, p boolean) returns void
language plpgsql security definer set search_path = public as $$
declare hb public.hall_bookings;
begin
  if k = 'tournament' then update public.registrations set paid = p where id::text = r;
  elsif k = 'training' then update public.bookings set paid = p where id::text = r;
  elsif k = 'order' then update public.orders set paid = p, updated_at = now() where id::text = r;
  elsif k = 'hall' then
    update public.hall_bookings set paid = p where id::text = r returning * into hb;
    -- Priority for paid players: a paid request for a free hour is confirmed straight away.
    if p and hb.status = 'requested' and not exists (
        select 1 from public.hall_bookings where slot_id = hb.slot_id and status = 'confirmed') then
      perform public.decide_hall_booking(hb.id, true);
    end if;
  end if;
end;
$$;

-- Payer: "I paid by wallet (receipt attached)" or "I will pay cash on the spot".
-- Sending again replaces an earlier pending or rejected one. Returns the payment id.
create or replace function public.submit_payment(k text, r text, m text, wallet text default null,
  receipt text default null, note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare tg record; pid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if m not in ('wallet', 'cash') then raise exception 'bad method'; end if;
  select * into tg from public.pay_target(k, r);
  if tg.payer <> auth.uid() then raise exception 'permission denied'; end if;
  if receipt is not null and receipt <> 'demo' and split_part(receipt, '/', 1) <> auth.uid()::text then
    raise exception 'bad receipt';
  end if;
  insert into public.payments (kind, ref, provider_id, payer_id, amount, method, wallet_kind, receipt_path, note)
  values (k, r, tg.provider, tg.payer, coalesce(tg.amount, 0), m, nullif(trim(wallet), ''), receipt, nullif(trim(note), ''))
  on conflict (kind, ref) do update set method = excluded.method, wallet_kind = excluded.wallet_kind,
      receipt_path = coalesce(excluded.receipt_path, public.payments.receipt_path), note = excluded.note,
      amount = excluded.amount, status = 'pending', created_at = now(), decided_at = null
    where public.payments.status <> 'approved'
  returning id into pid;
  if pid is null then raise exception 'already approved'; end if;
  return pid;
end;
$$;

-- Provider (or admin): approve or reject a payment. Approving ticks "paid".
create or replace function public.decide_payment(pay uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare py public.payments;
begin
  select * into py from public.payments where id = pay for update;
  if not found then raise exception 'not found'; end if;
  if not (py.provider_id = auth.uid() or public.is_admin()) then raise exception 'permission denied'; end if;
  update public.payments set status = case when approve then 'approved' else 'rejected' end, decided_at = now() where id = pay;
  perform public.apply_paid(py.kind, py.ref, approve);
end;
$$;

-- Provider (or admin): tick "paid" by hand, with or without a receipt (e.g. cash received).
-- A waiting payment row follows the tick.
create or replace function public.set_paid(k text, r text, p boolean) returns void
language plpgsql security definer set search_path = public as $$
declare tg record;
begin
  select * into tg from public.pay_target(k, r);
  if not (tg.provider = auth.uid() or public.is_admin()) then raise exception 'permission denied'; end if;
  perform public.apply_paid(k, r, coalesce(p, false));
  update public.payments set status = case when p then 'approved' else 'pending' end, decided_at = case when p then now() end
    where kind = k and ref = r;
end;
$$;

-- Organizer: registrations of a tournament with payment state (paid first: priority to who paid).
create or replace function public.tournament_payments(t text)
returns table (registration_id uuid, player_id uuid, status text, paid boolean, payment_id uuid, method text,
  wallet_kind text, receipt_path text, pay_status text, pay_note text, paid_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  return query
    select g.id, g.player_id, g.status, g.paid, p.id, p.method, p.wallet_kind, p.receipt_path, p.status, p.note, p.created_at
    from public.registrations g left join public.payments p on p.kind = 'tournament' and p.ref = g.id::text
    where g.tournament_id = t
    order by g.paid desc, (p.status = 'pending') desc nulls last, g.created_at;
end;
$$;

-- Player: own registrations' payment state, for the tournament page.
create or replace function public.my_registration(t text)
returns table (registration_id uuid, status text, paid boolean)
language sql stable security definer set search_path = public as $$
  select id, status, paid from public.registrations where tournament_id = t and player_id = auth.uid();
$$;

---------------------------------------------------------------- receipts

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts: upload to own folder" on storage.objects;
create policy "receipts: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts: payer provider admin read" on storage.objects;
create policy "receipts: payer provider admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (select 1 from public.payments p where p.receipt_path = storage.objects.name and p.provider_id = auth.uid())));

------------------------------------------------------------ simulation

-- Hall owner: `n` demo players ask for random free hours of the caller's halls in the next 7 days.
-- With `players`, those players ask in turn; with `hall`, only that hall. Returns how many requests were made.
create or replace function public.sim_hall(n int, players uuid[] default null, hall uuid default null) returns int
language plpgsql security definer set search_path = public, auth as $$
declare sl record; who uuid[]; i int := 0;
begin
  if not (public.is_hall() or public.is_admin()) then raise exception 'permission denied'; end if;
  who := coalesce(nullif(array(select x from unnest(players) x where public.is_sim_player(x)), '{}'),
    array(select u.id from auth.users u where u.email like 'sim__@demo.pingo.example' order by random()));
  if coalesce(array_length(who, 1), 0) = 0 then raise exception 'no demo players'; end if;
  for sl in select s.*, h.price_hour from public.hall_slots s join public.halls h on h.id = s.hall_id
      where s.owner_id = auth.uid() and (sim_hall.hall is null or s.hall_id = sim_hall.hall) and not s.taken and s.starts_at > now() and s.starts_at < now() + interval '7 days'
      order by random() limit greatest(1, least(coalesce(n, 1), 60)) loop
    insert into public.hall_bookings (slot_id, hall_id, owner_id, player_id, amount)
    values (sl.id, sl.hall_id, sl.owner_id, who[1 + i % array_length(who, 1)], sl.price_hour)
    on conflict (slot_id, player_id) do nothing;
    if found then i := i + 1; end if;
  end loop;
  return i;
end;
$$;

-- Any provider: demo players with nothing paid yet send payments for the caller's items
-- (kind 'tournament' needs t). About 70% by wallet with a demo receipt, the rest cash. Returns how many.
create or replace function public.sim_pay(k text, t text default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; i int := 0;
begin
  for r in
    select g.id::text ref, g.player_id payer, tt.organizer_id prov, coalesce(nullif(tt.state ->> 'fee', '')::numeric, 0) amt
      from public.registrations g join public.tournaments tt on tt.id = g.tournament_id
      where k = 'tournament' and g.tournament_id = t and public.owns_tournament(t) and g.status in ('pending', 'approved') and not g.paid
    union all
    select b.id::text, b.player_id, b.trainer_id, s.price from public.bookings b join public.training_slots s on s.id = b.slot_id
      where k = 'training' and b.trainer_id = auth.uid() and b.status = 'booked' and not b.paid
    union all
    select b.id::text, b.player_id, b.owner_id, b.amount from public.hall_bookings b
      where k = 'hall' and b.owner_id = auth.uid() and b.status in ('requested', 'confirmed') and not b.paid
    union all
    select o.id::text, o.buyer_id, o.seller_id, o.total from public.orders o
      where k = 'order' and o.seller_id = auth.uid() and o.status <> 'cancelled' and not o.paid
  loop
    continue when not public.is_sim_player(r.payer);
    continue when random() > 0.8;
    insert into public.payments (kind, ref, provider_id, payer_id, amount, method, wallet_kind, receipt_path)
    values (k, r.ref, r.prov, r.payer, r.amt, case when random() < 0.7 then 'wallet' else 'cash' end,
      (array['vodafone', 'instapay', 'fawry'])[1 + floor(random() * 3)::int], null)
    on conflict (kind, ref) do nothing;
    if found then i := i + 1; end if;
  end loop;
  update public.payments set receipt_path = 'demo'
    where method = 'wallet' and receipt_path is null and provider_id = auth.uid() and public.is_sim_player(payer_id);
  return i;
end;
$$;

-- Same as 0012, plus 'hall' (frees demo players' hall requests) and payments of demo players.
create or replace function public.sim_clear(kind text, t text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c int := 0;
begin
  if kind = 'trainer' then
    if not (public.is_trainer() or public.is_admin()) then raise exception 'permission denied'; end if;
    delete from public.payments p using public.bookings b
      where p.kind = 'training' and p.ref = b.id::text and b.trainer_id = auth.uid() and public.is_sim_player(b.player_id);
    update public.training_slots s set booked = false
      where s.trainer_id = auth.uid() and exists (select 1 from public.bookings b
        where b.slot_id = s.id and b.status = 'booked' and public.is_sim_player(b.player_id));
    delete from public.bookings where trainer_id = auth.uid() and public.is_sim_player(player_id);
    get diagnostics c = row_count;
  elsif kind = 'seller' then
    if not (public.is_seller() or public.is_admin()) then raise exception 'permission denied'; end if;
    delete from public.payments p using public.orders o
      where p.kind = 'order' and p.ref = o.id::text and o.seller_id = auth.uid() and public.is_sim_player(o.buyer_id);
    update public.products p set stock = p.stock + x.q
      from (select product_id, sum(qty) q from public.orders
            where seller_id = auth.uid() and status <> 'cancelled' and product_id is not null and public.is_sim_player(buyer_id)
            group by product_id) x
      where p.id = x.product_id;
    delete from public.orders where seller_id = auth.uid() and public.is_sim_player(buyer_id);
    get diagnostics c = row_count;
  elsif kind = 'organizer' then
    if t is null or not public.owns_tournament(t) then raise exception 'permission denied'; end if;
    delete from public.payments p using public.registrations g
      where p.kind = 'tournament' and p.ref = g.id::text and g.tournament_id = t and public.is_sim_player(g.player_id);
    delete from public.registrations where tournament_id = t and public.is_sim_player(player_id);
    get diagnostics c = row_count;
  elsif kind = 'hall' then
    if not (public.is_hall() or public.is_admin()) then raise exception 'permission denied'; end if;
    delete from public.payments p using public.hall_bookings b
      where p.kind = 'hall' and p.ref = b.id::text and b.owner_id = auth.uid() and public.is_sim_player(b.player_id);
    update public.hall_slots s set taken = false
      where s.owner_id = auth.uid() and exists (select 1 from public.hall_bookings b
        where b.slot_id = s.id and b.status = 'confirmed' and public.is_sim_player(b.player_id));
    delete from public.hall_bookings where owner_id = auth.uid() and public.is_sim_player(player_id);
    get diagnostics c = row_count;
  else
    raise exception 'bad kind';
  end if;
  return c;
end;
$$;

-- Demo players for hall owners too (same as 0012 plus is_hall).
create or replace function public.sim_players()
returns table (id uuid, full_name text, club text, avatar_url text, gender text, birth_year int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (public.is_organizer() or public.is_trainer() or public.is_seller() or public.is_hall() or public.is_admin()) then
    raise exception 'permission denied';
  end if;
  return query
    select p.id, p.full_name, p.club, p.avatar_url, p.gender, p.birth_year
    from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'sim__@demo.pingo.example'
    order by u.email;
end;
$$;

-------------------------------------------------------- admin overview

-- Same as 0006 plus halls.
create or replace function public.admin_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'organizers', (select count(*) from public.profiles where is_organizer or role in ('organizer', 'admin')),
    'sellers', (select count(*) from public.profiles where is_seller),
    'trainers', (select count(*) from public.profiles where is_trainer),
    'halls', (select count(*) from public.profiles where is_hall),
    'tournaments', (select count(*) from public.tournaments),
    'running', (select count(*) from public.tournaments where status in ('registration', 'running')),
    'posts', (select count(*) from public.posts),
    'products', (select count(*) from public.products),
    'pendingProducts', (select count(*) from public.products where not approved),
    'pendingRoles', (select count(*) from public.role_requests where status = 'pending'),
    'orders', (select count(*) from public.orders),
    'bookings', (select count(*) from public.bookings where status = 'booked'),
    'hallBookings', (select count(*) from public.hall_bookings where status in ('requested', 'confirmed'))
  ) end;
$$;

---------------------------------------------------------------- grants

do $$
declare f text;
begin
  foreach f in array array[
    'hall_slot_requests(uuid)', 'book_hall_slots(uuid[])', 'cancel_deadline(uuid, timestamptz)',
    'decide_hall_booking(uuid, boolean)', 'cancel_hall_booking(uuid)', 'my_hall_players()',
    'pay_target(text, text)', 'submit_payment(text, text, text, text, text, text)',
    'decide_payment(uuid, boolean)', 'set_paid(text, text, boolean)', 'tournament_payments(text)',
    'my_registration(text)', 'sim_hall(int, uuid[], uuid)', 'sim_pay(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internal only: called from the functions above.
  revoke all on function public.apply_paid(text, text, boolean) from public, anon, authenticated;
end;
$$;
grant execute on function public.hall_slot_requests(uuid) to anon;
grant execute on function public.cancel_deadline(uuid, timestamptz) to anon;
