-- Pingo: role tools (organizer, trainer, seller) with simulations and payment tracking (Nov 2026).
-- Run after 0001–0011. Safe to run again.
-- * bookings.paid / orders.paid: the trainer or seller ticks when the money is received.
-- * Tournament entry fees and who paid live in the tournament state (fee, paid), saved by the organizer.
-- * The 40 simulation players are accounts sim01..sim40@demo.pingo.example (supabase/seed/sim_players.sql).
--   The sim_* functions let an organizer, trainer or seller make those players join, book or order,
--   only for the caller's own tournaments, slots and products, and clear it again.

------------------------------------------------------------------ payments

alter table public.bookings add column if not exists paid boolean not null default false;
alter table public.orders add column if not exists paid boolean not null default false;

create or replace function public.set_booking_paid(b uuid, p boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set paid = coalesce(p, false)
  where id = b and (trainer_id = auth.uid() or public.is_admin());
  if not found then raise exception 'permission denied'; end if;
end;
$$;

create or replace function public.set_order_paid(o uuid, p boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set paid = coalesce(p, false), updated_at = now()
  where id = o and (seller_id = auth.uid() or public.is_admin());
  if not found then raise exception 'permission denied'; end if;
end;
$$;

---------------------------------------------------------- simulation players

create or replace function public.is_sim_player(p uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where id = p and email like 'sim__@demo.pingo.example');
$$;

-- The 40 demo players (name, club, photo), for organizers, trainers, sellers and admins.
create or replace function public.sim_players()
returns table (id uuid, full_name text, club text, avatar_url text, gender text, birth_year int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (public.is_organizer() or public.is_trainer() or public.is_seller() or public.is_admin()) then
    raise exception 'permission denied';
  end if;
  return query
    select p.id, p.full_name, p.club, p.avatar_url, p.gender, p.birth_year
    from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'sim__@demo.pingo.example'
    order by u.email;
end;
$$;

-- Organizer: chosen demo players ask to join one of the caller's tournaments (open registration).
-- Follows the tournament's own settings: auto-accept and player limit. Returns how many joined.
create or replace function public.sim_join(t text, players uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; taken int; added int := 0; p uuid;
begin
  if not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  select * into tour from public.tournaments where id = t for update;
  if tour.status <> 'registration' then raise exception 'registration closed'; end if;
  foreach p in array coalesce(players, '{}') loop
    continue when not public.is_sim_player(p);
    select count(*) into taken from public.registrations
      where tournament_id = t and status in ('pending', 'approved');
    exit when tour.max_players is not null and taken >= tour.max_players;
    insert into public.registrations (tournament_id, player_id, status, decided_at)
    values (t, p, case when tour.auto_accept then 'approved' else 'pending' end, case when tour.auto_accept then now() end)
    on conflict (tournament_id, player_id) do update
      set status = excluded.status, created_at = now(), decided_at = excluded.decided_at
      where public.registrations.status in ('withdrawn', 'rejected');
    if found then added := added + 1; end if;
  end loop;
  return added;
end;
$$;

-- Trainer: demo players book `n` of the caller's free future slots (soonest first).
-- With `players`, those players book in turn; otherwise random demo players. Returns how many were booked.
create or replace function public.sim_book(n int, players uuid[] default null) returns int
language plpgsql security definer set search_path = public, auth as $$
declare sl record; who uuid[]; i int := 0;
begin
  if not (public.is_trainer() or public.is_admin()) then raise exception 'permission denied'; end if;
  who := coalesce(nullif(array(select x from unnest(players) x where public.is_sim_player(x)), '{}'),
    array(select u.id from auth.users u where u.email like 'sim__@demo.pingo.example' order by random()));
  if coalesce(array_length(who, 1), 0) = 0 then raise exception 'no demo players'; end if;
  for sl in select * from public.training_slots
      where trainer_id = auth.uid() and not booked and starts_at > now()
      order by starts_at limit greatest(1, least(coalesce(n, 1), 50)) for update loop
    update public.training_slots set booked = true where id = sl.id;
    insert into public.bookings (slot_id, trainer_id, player_id, note, paid)
    values (sl.id, sl.trainer_id, who[1 + i % array_length(who, 1)], null, random() < 0.4);
    i := i + 1;
  end loop;
  return i;
end;
$$;

-- Seller: `n` orders from demo customers for the caller's active products in stock.
-- With `players`, those customers order in turn; otherwise random ones. Returns how many orders were placed.
create or replace function public.sim_order(n int, players uuid[] default null) returns int
language plpgsql security definer set search_path = public, auth as $$
declare prod public.products; who uuid[]; buyer uuid; q int; i int := 0; ph text;
begin
  if not (public.is_seller() or public.is_admin()) then raise exception 'permission denied'; end if;
  who := coalesce(nullif(array(select x from unnest(players) x where public.is_sim_player(x)), '{}'),
    array(select u.id from auth.users u where u.email like 'sim__@demo.pingo.example' order by random()));
  if coalesce(array_length(who, 1), 0) = 0 then raise exception 'no demo players'; end if;
  for k in 1 .. greatest(1, least(coalesce(n, 1), 50)) loop
    select * into prod from public.products
      where seller_id = auth.uid() and active and stock > 0 order by random() limit 1 for update;
    exit when not found;
    buyer := who[1 + i % array_length(who, 1)];
    q := least(prod.stock, 1 + floor(random() * 3)::int);
    select phone into ph from public.profiles where id = buyer;
    update public.products set stock = stock - q where id = prod.id;
    insert into public.orders (product_id, product_name, seller_id, buyer_id, qty, total, phone, note, status, paid)
    values (prod.id, prod.name, prod.seller_id, buyer, q, prod.price * q, ph, null,
      (array['pending', 'pending', 'confirmed', 'delivered'])[1 + floor(random() * 4)::int], random() < 0.35);
    i := i + 1;
  end loop;
  return i;
end;
$$;

-- Undo the caller's simulation: 'trainer' frees slots booked by demo players, 'seller' removes
-- demo customers' orders (stock goes back), 'organizer' removes demo players' join requests
-- from tournament `t` (the organizer saves the tournament state itself). Returns rows removed.
create or replace function public.sim_clear(kind text, t text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c int := 0;
begin
  if kind = 'trainer' then
    if not (public.is_trainer() or public.is_admin()) then raise exception 'permission denied'; end if;
    update public.training_slots s set booked = false
      where s.trainer_id = auth.uid() and exists (select 1 from public.bookings b
        where b.slot_id = s.id and b.status = 'booked' and public.is_sim_player(b.player_id));
    delete from public.bookings where trainer_id = auth.uid() and public.is_sim_player(player_id);
    get diagnostics c = row_count;
  elsif kind = 'seller' then
    if not (public.is_seller() or public.is_admin()) then raise exception 'permission denied'; end if;
    update public.products p set stock = p.stock + x.q
      from (select product_id, sum(qty) q from public.orders
            where seller_id = auth.uid() and status <> 'cancelled' and product_id is not null and public.is_sim_player(buyer_id)
            group by product_id) x
      where p.id = x.product_id;
    delete from public.orders where seller_id = auth.uid() and public.is_sim_player(buyer_id);
    get diagnostics c = row_count;
  elsif kind = 'organizer' then
    if t is null or not public.owns_tournament(t) then raise exception 'permission denied'; end if;
    delete from public.registrations where tournament_id = t and public.is_sim_player(player_id);
    get diagnostics c = row_count;
  else
    raise exception 'bad kind';
  end if;
  return c;
end;
$$;

revoke all on function public.set_booking_paid(uuid, boolean) from public, anon;
revoke all on function public.set_order_paid(uuid, boolean) from public, anon;
revoke all on function public.is_sim_player(uuid) from public, anon;
revoke all on function public.sim_players() from public, anon;
revoke all on function public.sim_join(text, uuid[]) from public, anon;
revoke all on function public.sim_book(int, uuid[]) from public, anon;
revoke all on function public.sim_order(int, uuid[]) from public, anon;
revoke all on function public.sim_clear(text, text) from public, anon;
grant execute on function public.set_booking_paid(uuid, boolean) to authenticated;
grant execute on function public.set_order_paid(uuid, boolean) to authenticated;
grant execute on function public.is_sim_player(uuid) to authenticated;
grant execute on function public.sim_players() to authenticated;
grant execute on function public.sim_join(text, uuid[]) to authenticated;
grant execute on function public.sim_book(int, uuid[]) to authenticated;
grant execute on function public.sim_order(int, uuid[]) to authenticated;
grant execute on function public.sim_clear(text, text) to authenticated;
