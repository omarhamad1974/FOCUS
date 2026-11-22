-- Pingo 0020: notifications (Omar, 2026-11-22). Safe to run more than once.
--
-- * notifications: one row per alert, made by triggers on the tables where things happen, so every
--   path (website, desk, simulation, Edge Function) alerts the same way. The bell in the header
--   reads them; the person marks them read or deletes them.
--   Repeats of the same thing (e.g. several join requests for one tournament) fold into one unread
--   row with a count instead of filling the list.
-- * notification_prefs: per person, the alert types switched off in the app and/or on the phone.
-- * push_subscriptions: devices that allowed phone notifications (Web Push, the installed app).
--   A new alert calls the Edge Function send-push through pg_net; the function signs with VAPID keys
--   it makes and keeps itself in push_config, so nothing has to be set up by hand.
-- * shop_follows: players follow sports shops (⭐) and hear about each new promotion.
-- * tournament_contacts(): names and mobiles of a tournament's players for its organizer
--   (one-tap WhatsApp messages from the organizer's tool).
-- * A daily job (pg_cron when available, and on each bell refresh) warns about subscriptions that
--   end within 7 days and clears read alerts older than 60 days.
--
-- No "your next match" calls and no email reminders (Omar).
-- Alert types: invites, entries, results, payments, bookings, orders, promos, requests, capacity,
-- products, roles. The app shows each person only the types that fit their roles.

------------------------------------------------------------- tables

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('invites', 'entries', 'results', 'payments', 'bookings', 'orders',
                'promos', 'requests', 'capacity', 'products', 'roles')),
  -- Same key + still unread = the same alert again: the row is updated and its count goes up.
  key         text,
  icon        text,
  title       text not null check (char_length(title) <= 160),
  body        text check (body is null or char_length(body) <= 400),
  link        text check (link is null or char_length(link) <= 200),
  count       int not null default 1,
  read_at     timestamptz,
  pushed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_key_idx on public.notifications (user_id, key) where key is not null;

alter table public.notifications enable row level security;
drop policy if exists "notifications: own read" on public.notifications;
create policy "notifications: own read" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notifications: own delete" on public.notifications;
create policy "notifications: own delete" on public.notifications for delete using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

create table if not exists public.notification_prefs (
  user_id   uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  app_off   text[] not null default '{}',
  push_off  text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "notification_prefs: own" on public.notification_prefs;
create policy "notification_prefs: own" on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant all on public.notification_prefs to service_role;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  device      text check (device is null or char_length(device) <= 120),
  created_at  timestamptz not null default now(),
  last_ok     timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions: own read" on public.push_subscriptions;
create policy "push_subscriptions: own read" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "push_subscriptions: own delete" on public.push_subscriptions;
create policy "push_subscriptions: own delete" on public.push_subscriptions for delete using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- One row, read only by the Edge Function (service role). Never visible to the app.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  -- The Edge Function checks this on every send, so only the database can ask it to send.
  secret      text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Filled by the Edge Function itself the first time it runs.
  endpoint    text,
  vapid_public text,
  vapid_keys  jsonb,
  updated_at  timestamptz not null default now()
);
insert into public.push_config (id) values (1) on conflict (id) do nothing;
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant all on public.push_config to service_role;

create table if not exists public.shop_follows (
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  shop_id     uuid not null references public.shops (owner_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, shop_id)
);
alter table public.shop_follows enable row level security;
drop policy if exists "shop_follows: own" on public.shop_follows;
create policy "shop_follows: own" on public.shop_follows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.shop_follows from anon, authenticated;
grant select, insert, delete on public.shop_follows to authenticated;
grant all on public.shop_follows to service_role;

-- Followers of a shop (a number only), for the shop page.
create or replace function public.shop_followers(s uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.shop_follows where shop_id = s;
$$;

------------------------------------------------------------- pg_net / pg_cron

-- pg_net sends the "push now" call from the database. Supabase has it; a plain Postgres
-- (tests) does not, and then alerts still appear in the app, only without phone pushes.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net not available: %', sqlerrm;
end $$;

------------------------------------------------------------- core

-- Arabic names of the roles people request.
create or replace function public.role_ar(r text) returns text
language sql immutable as $$
  select case r when 'organizer' then 'منظم بطولات' when 'trainer' then 'مدرب' when 'seller' then 'بائع'
    when 'hall' then 'صاحب صالة' else r end;
$$;

create or replace function public.person_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = p), 'لاعب');
$$;

-- "الخميس 26/11 7:00 م" style time in Cairo, kept short for one line.
create or replace function public.cairo_time(at timestamptz) returns text
language sql immutable as $$
  select to_char(at at time zone 'Africa/Cairo', 'DD/MM HH24:MI');
$$;

-- Ask the Edge Function to push one alert to the person's devices (when they have any and want it).
create or replace function public.push_dispatch(nid uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare n public.notifications; cfg public.push_config;
begin
  select * into n from public.notifications where id = nid;
  if not found then return; end if;
  if exists (select 1 from public.notification_prefs where user_id = n.user_id and n.kind = any(push_off)) then return; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = n.user_id) then return; end if;
  select * into cfg from public.push_config where id = 1;
  if cfg.endpoint is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
    using cfg.endpoint, jsonb_build_object('id', nid),
      jsonb_build_object('Content-Type', 'application/json', 'x-push-key', cfg.secret);
exception when others then
  raise warning 'push_dispatch: %', sqlerrm;
end;
$$;

-- Make (or fold into) one alert. Never raises: a failed alert must not undo the real action.
-- grp: key for folding repeats; once: with grp, make it only if that key never existed for the person.
create or replace function public.notify(target uuid, k text, ttl text, msg text default null, lnk text default null,
  ic text default null, grp text default null, once boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if target is null then return; end if;
  -- The 40 demo players never read alerts.
  if public.is_sim_player(target) then return; end if;
  if exists (select 1 from public.notification_prefs where user_id = target and k = any(app_off)) then return; end if;
  if grp is not null and once then
    if exists (select 1 from public.notifications where user_id = target and key = grp) then return; end if;
  elsif grp is not null then
    update public.notifications set count = count + 1, title = left(ttl, 160), body = left(msg, 400),
        link = coalesce(lnk, link), created_at = now(), pushed_at = null
      where id = (select id from public.notifications where user_id = target and key = grp and read_at is null
                  and created_at > now() - interval '24 hours' order by created_at desc limit 1)
      returning id into nid;
  end if;
  if nid is null then
    insert into public.notifications (user_id, kind, key, icon, title, body, link)
    values (target, k, grp, ic, left(ttl, 160), left(msg, 400), lnk) returning id into nid;
  end if;
  perform public.push_dispatch(nid);
exception when others then
  raise warning 'notify: %', sqlerrm;
end;
$$;

-- Every admin gets it.
create or replace function public.notify_admins(k text, ttl text, msg text default null, lnk text default null,
  ic text default null, grp text default null, once boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify(a, k, ttl, msg, lnk, ic, grp, once);
  end loop;
end;
$$;

-- Did the player do this themselves? (Demo players count as acting themselves in simulations.)
create or replace function public.by_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = p or public.is_sim_player(p);
$$;

------------------------------------------------------------- app functions

create or replace function public.notifications_unread() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null;
$$;

-- Mark some (ids) or all (null) of the caller's alerts as read.
create or replace function public.notifications_read(ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (ids is null or id = any(ids));
$$;

create or replace function public.notifications_clear() returns void
language sql security definer set search_path = public as $$
  delete from public.notifications where user_id = auth.uid() and read_at is not null;
$$;

create or replace function public.set_notification_prefs(app_off text[], push_off text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.notification_prefs (user_id, app_off, push_off, updated_at)
  values (auth.uid(), coalesce(app_off, '{}'), coalesce(push_off, '{}'), now())
  on conflict (user_id) do update set app_off = excluded.app_off, push_off = excluded.push_off, updated_at = now();
end;
$$;

-- This device allowed notifications: remember it for the signed-in person (a shared device moves over).
create or replace function public.save_push_subscription(ep text, key_p256dh text, key_auth text, device_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), ep, key_p256dh, key_auth, left(device_name, 120))
  on conflict on constraint push_subscriptions_endpoint_key do update set user_id = auth.uid(), p256dh = excluded.p256dh,
    auth = excluded.auth, device = excluded.device, created_at = now();
end;
$$;

create or replace function public.remove_push_subscription(ep text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = ep and user_id = auth.uid();
$$;

-- Organizer (own tournament) or admin: names and mobiles of the players, for WhatsApp messages.
create or replace function public.tournament_contacts(t text)
returns table (player_id uuid, full_name text, phone text, status text, paid boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.owns_tournament(t) then raise exception 'permission denied'; end if;
  return query
    select g.player_id, p.full_name,
      coalesce(nullif(p.phone, ''), (select split_part(u.email, '@', 1) from auth.users u
        where u.id = g.player_id and u.email like '%@phone.pingo.example')),
      g.status, g.paid
    from public.registrations g join public.profiles p on p.id = g.player_id
    where g.tournament_id = t and g.status in ('pending', 'approved')
    order by g.status, p.full_name;
end;
$$;

------------------------------------------------------------- daily alerts

-- Subscriptions that end within 7 days (and have no later period): the person and the admins hear once.
-- Read alerts older than 60 days are cleared. Safe to run as often as wanted.
create or replace function public.daily_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  for s in select x.* from public.subscriptions x
      where x.ends_on between current_date and current_date + 7
        and not exists (select 1 from public.subscriptions y where y.user_id = x.user_id and y.role = x.role and y.ends_on > x.ends_on) loop
    perform public.notify(s.user_id, 'roles', 'اشتراكك ينتهي قريباً',
      'اشتراك ' || public.role_ar(s.role) || ' ينتهي يوم ' || to_char(s.ends_on, 'DD/MM') || '. جدّده لتستمر أدواتك بدون توقف.',
      '#/desk', 'clock', 'subend:' || s.id, true);
    perform public.notify_admins('roles', 'اشتراك ينتهي خلال أسبوع',
      public.person_name(s.user_id) || ' (' || public.role_ar(s.role) || ') ينتهي يوم ' || to_char(s.ends_on, 'DD/MM'),
      '#/desk/admin/subs', 'clock', 'subend-admin:' || s.id, true);
  end loop;
  delete from public.notifications where read_at is not null and created_at < now() - interval '60 days';
end;
$$;

-- Called by the bell when it loads: at most every few hours does real work.
create or replace function public.notifications_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if exists (select 1 from public.push_config where id = 1 and updated_at > now() - interval '3 hours') then return; end if;
  update public.push_config set updated_at = now() where id = 1;
  perform public.daily_alerts();
end;
$$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'pingo-daily-alerts';
  perform cron.schedule('pingo-daily-alerts', '0 7 * * *', 'select public.daily_alerts()');
exception when others then raise notice 'pg_cron not available, the bell refresh runs the daily alerts: %', sqlerrm;
end $$;

------------------------------------------------------------- triggers: tournaments

create or replace function public.alert_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments; who text; taken int; lnk text; desk text;
begin
  select * into tour from public.tournaments where id = new.tournament_id;
  if not found then return null; end if;
  who := public.person_name(new.player_id);
  lnk := '#/t/' || tour.id;
  desk := '#/desk/org/' || tour.id;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;

  if new.status = 'pending' then
    if public.by_player(new.player_id) then
      perform public.notify(tour.organizer_id, 'requests', 'طلب انضمام جديد: ' || tour.name,
        who || ' يطلب الانضمام. اقبل أو ارفض من مكتب البطولة.', desk, 'userPlus', 'req:' || tour.id);
    else
      perform public.notify(new.player_id, 'entries', 'أنت على قائمة انتظار ' || tour.name,
        'سجّلك المنظم في قائمة الانتظار، وسنخبرك عند قبولك.', lnk, 'clock');
    end if;
  elsif new.status = 'approved' then
    if tg_op = 'UPDATE' and old.status = 'pending' then
      perform public.notify(new.player_id, 'entries', 'تم قبولك في ' || tour.name || ' 🎉',
        'أنت الآن من لاعبي البطولة. شاهد التفاصيل والرسوم من صفحة البطولة.', lnk, 'check');
    elsif public.by_player(new.player_id) then
      perform public.notify(tour.organizer_id, 'requests', 'لاعب جديد في ' || tour.name,
        who || ' انضم إلى البطولة.', desk, 'userPlus', 'join:' || tour.id);
    else
      perform public.notify(new.player_id, 'entries', 'تمت إضافتك إلى ' || tour.name || ' 🎉',
        'أضافك المنظم إلى البطولة مباشرة.', lnk, 'check');
    end if;
  elsif new.status = 'rejected' and tg_op = 'UPDATE' and old.status in ('pending', 'approved') then
    perform public.notify(new.player_id, 'entries', 'لم يتم قبولك في ' || tour.name,
      'اعتذر المنظم عن قبول طلبك هذه المرة. تابع بطولات أخرى مفتوحة للتسجيل.', '#/tournaments', 'x');
  elsif new.status = 'withdrawn' and tg_op = 'UPDATE' and old.status in ('pending', 'approved') then
    perform public.notify(tour.organizer_id, 'requests', 'انسحاب من ' || tour.name,
      who || ' انسحب من البطولة.', desk, 'logout', 'wd:' || tour.id);
  end if;

  -- Registration nearly full / full: once each per tournament.
  if new.status in ('pending', 'approved') and tour.max_players is not null and tour.status = 'registration' then
    select count(*) into taken from public.registrations where tournament_id = tour.id and status in ('pending', 'approved');
    if taken >= tour.max_players then
      perform public.notify(tour.organizer_id, 'capacity', 'اكتمل العدد في ' || tour.name,
        taken || ' من ' || tour.max_players || ' لاعب. أغلق التسجيل ووزّع المجموعات عندما تكون جاهزاً.', desk, 'users', 'full:' || tour.id, true);
    elsif tour.max_players >= 5 and taken >= ceil(tour.max_players * 0.8) then
      perform public.notify(tour.organizer_id, 'capacity', 'العدد يقترب من الاكتمال: ' || tour.name,
        taken || ' من ' || tour.max_players || ' لاعب حتى الآن.', desk, 'users', 'near:' || tour.id, true);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists registrations_alert on public.registrations;
create trigger registrations_alert after insert or update of status on public.registrations
  for each row execute function public.alert_registration();

create or replace function public.alert_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare tour public.tournaments;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select * into tour from public.tournaments where id = new.tournament_id;
  if not found then return null; end if;
  if new.status = 'pending' then
    perform public.notify(new.player_id, 'invites', 'دعوة للمشاركة في ' || tour.name,
      public.person_name(coalesce(new.invited_by, tour.organizer_id)) || ' يدعوك للبطولة. اقبل أو اعتذر بلمسة.',
      '#/t/' || tour.id, 'mail');
  elsif new.status = 'declined' then
    perform public.notify(tour.organizer_id, 'requests', 'اعتذار عن دعوة ' || tour.name,
      public.person_name(new.player_id) || ' اعتذر عن الدعوة.', '#/desk/org/' || tour.id, 'mail', 'decl:' || tour.id);
  end if;
  return null;
end;
$$;
drop trigger if exists invitations_alert on public.invitations;
create trigger invitations_alert after insert or update of status on public.invitations
  for each row execute function public.alert_invitation();

-- Games won by each side of a match in the app's saved state (result, games or walkover).
create or replace function public.match_games(m jsonb, out a int, out b int)
language plpgsql immutable as $$
declare g jsonb;
begin
  a := 0; b := 0;
  if m is null then return; end if;
  if coalesce(m ->> 'walkover', '') in ('a', 'b') then
    if m ->> 'walkover' = 'a' then a := 1; else b := 1; end if;
    return;
  end if;
  if jsonb_typeof(m -> 'result') = 'object' then
    a := coalesce((m -> 'result' ->> 'a')::int, 0); b := coalesce((m -> 'result' ->> 'b')::int, 0);
    return;
  end if;
  if jsonb_typeof(m -> 'games') = 'array' then
    for g in select * from jsonb_array_elements(m -> 'games') loop
      if (g ->> 'a')::int > (g ->> 'b')::int then a := a + 1; elsif (g ->> 'b')::int > (g ->> 'a')::int then b := b + 1; end if;
    end loop;
  end if;
end;
$$;

-- A finished match: walkover, or one side reached the games needed (2 of 3, 3 of 5).
create or replace function public.match_done(m jsonb) returns boolean
language plpgsql immutable as $$
declare sc record; need int;
begin
  if m is null or jsonb_typeof(m) <> 'object' then return false; end if;
  if coalesce(m ->> 'walkover', '') in ('a', 'b') then return true; end if;
  need := (coalesce(nullif(m ->> 'bestOf', '')::int, 3) + 1) / 2;
  select * into sc from public.match_games(m);
  return greatest(sc.a, sc.b) >= need;
exception when others then return false;
end;
$$;

-- Account behind a player id in the tournament state.
create or replace function public.state_account(st jsonb, pid text) returns uuid
language plpgsql immutable as $$
declare p jsonb; v text;
begin
  if pid is null then return null; end if;
  select x into p from jsonb_array_elements(coalesce(st -> 'players', '[]')) x where x ->> 'id' = pid limit 1;
  v := coalesce(p ->> 'profileId', p ->> 'accountId');
  if v ~ '^[0-9a-f-]{36}$' then return v::uuid; end if;
  return null;
exception when others then return null;
end;
$$;

create or replace function public.state_name(st jsonb, pid text) returns text
language sql immutable as $$
  select coalesce((select x ->> 'name' from jsonb_array_elements(coalesce(st -> 'players', '[]')) x where x ->> 'id' = pid limit 1), '؟');
$$;

-- Draw out, tournament finished, and each newly entered result for the two players.
create or replace function public.alert_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; m jsonb; om jsonb; sc record; side text; acc uuid; mine int; theirs int; other text; lnk text;
begin
  lnk := '#/t/' || new.id;
  if new.status is distinct from old.status and new.status in ('running', 'finished') then
    for r in select player_id from public.registrations where tournament_id = new.id and status = 'approved' loop
      if new.status = 'running' then
        perform public.notify(r.player_id, 'results', 'بدأت ' || new.name || ': القرعة جاهزة',
          'اعرف مجموعتك ومنافسيك من صفحة البطولة.', lnk, 'trophy', 'start:' || new.id, true);
      else
        perform public.notify(r.player_id, 'results', 'انتهت ' || new.name || ' 🏆',
          'شاهد البطل والترتيب النهائي وشارك نتيجتك.', lnk, 'trophy', 'end:' || new.id, true);
      end if;
    end loop;
  end if;
  if new.state -> 'matches' is distinct from old.state -> 'matches' and jsonb_typeof(new.state -> 'matches') = 'object' then
    for m in select value from jsonb_each(new.state -> 'matches') loop
      om := old.state -> 'matches' -> (m ->> 'id');
      -- Only matches completed just now (a corrected result does not alert again).
      continue when not public.match_done(m) or public.match_done(om);
      select * into sc from public.match_games(m);
      foreach side in array array['a', 'b'] loop
        acc := public.state_account(new.state, m ->> (side || 'Id'));
        continue when acc is null;
        mine := case when side = 'a' then sc.a else sc.b end;
        theirs := case when side = 'a' then sc.b else sc.a end;
        other := public.state_name(new.state, m ->> (case when side = 'a' then 'bId' else 'aId' end));
        perform public.notify(acc, 'results',
          case when mine > theirs then 'فزت ' || mine || '-' || theirs || ' 🎉' else 'نتيجة مباراتك: ' || mine || '-' || theirs end,
          'ضد ' || other || ' في ' || new.name || '.', lnk, 'ball', 'res:' || new.id);
      end loop;
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists tournaments_alert on public.tournaments;
create trigger tournaments_alert after update on public.tournaments
  for each row execute function public.alert_tournament();

------------------------------------------------------------- triggers: payments

-- What a payment is for, in a few words.
create or replace function public.pay_label(k text, r text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if k = 'tournament' then
    select 'اشتراك ' || t.name into s from public.registrations g join public.tournaments t on t.id = g.tournament_id where g.id::text = r;
  elsif k = 'training' then
    select 'حصة تدريب ' || public.cairo_time(sl.starts_at) into s from public.bookings b join public.training_slots sl on sl.id = b.slot_id where b.id::text = r;
  elsif k = 'hall' then
    select 'حجز ' || h.name || ' ' || public.cairo_time(sl.starts_at) into s
      from public.hall_bookings b join public.halls h on h.id = b.hall_id join public.hall_slots sl on sl.id = b.slot_id where b.id::text = r;
  elsif k = 'order' then
    select 'طلب ' || o.product_name into s from public.orders o where o.id::text = r;
  end if;
  return coalesce(s, 'دفعة');
end;
$$;

create or replace function public.alert_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare what text; desk text; mine text; amt text;
begin
  what := public.pay_label(new.kind, new.ref);
  amt := trim(to_char(new.amount, 'FM999999990.##')) || ' ج.م';
  desk := case new.kind
    when 'tournament' then '#/desk/org/' || coalesce((select tournament_id from public.registrations where id::text = new.ref), '')
    when 'training' then '#/desk/trainer' when 'hall' then '#/desk/hall' else '#/desk/seller' end;
  mine := case new.kind when 'tournament' then '#/t/' || coalesce((select tournament_id from public.registrations where id::text = new.ref), '')
    else '#/me' end;
  -- Sent (or sent again) by the payer.
  if new.status = 'pending' and (tg_op = 'INSERT' or new.created_at is distinct from old.created_at) then
    perform public.notify(new.provider_id, 'payments',
      case when new.method = 'cash' then 'دفع نقدي عند الحضور' else 'إيصال دفع جديد' end,
      public.person_name(new.payer_id) || ': ' || what || ' (' || amt || ')' ||
        case when new.method = 'cash' then '' else '. راجع الإيصال واقبله.' end,
      desk, 'money', 'pay:' || new.kind);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'approved' then
    perform public.notify(new.payer_id, 'payments', 'تم تأكيد دفعك ✅', what || ' (' || amt || ').', mine, 'check');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'rejected' then
    perform public.notify(new.payer_id, 'payments', 'لم يُقبل الدفع', what || '. راجع البيانات وأرسل الإيصال من جديد.', mine, 'x');
  end if;
  return null;
end;
$$;
drop trigger if exists payments_alert on public.payments;
create trigger payments_alert after insert or update on public.payments
  for each row execute function public.alert_payment();

------------------------------------------------------------- triggers: bookings

create or replace function public.alert_hall_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text; at text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select name into h from public.halls where id = new.hall_id;
  select public.cairo_time(starts_at) || ' طاولة ' || table_no into at from public.hall_slots where id = new.slot_id;
  if new.status = 'requested' then
    perform public.notify(new.owner_id, 'bookings', 'طلب حجز جديد في ' || h,
      public.person_name(new.player_id) || ' طلب ' || coalesce(at, ''), '#/desk/hall', 'table', 'hb:' || new.hall_id);
  elsif new.status = 'confirmed' then
    perform public.notify(new.player_id, 'bookings', 'تم تأكيد حجزك في ' || h || ' ✅', coalesce(at, ''), '#/me', 'check');
  elsif new.status = 'rejected' and tg_op = 'UPDATE' and old.status = 'requested' then
    perform public.notify(new.player_id, 'bookings', 'تعذّر تأكيد حجزك في ' || h,
      coalesce(at, '') || ' محجوزة. اختر ساعة أخرى.', '#/halls', 'x');
  elsif new.status = 'cancelled' then
    if auth.uid() = new.owner_id or (auth.uid() is distinct from new.player_id and public.is_admin()) then
      perform public.notify(new.player_id, 'bookings', 'أُلغي حجزك في ' || h, coalesce(at, ''), '#/halls', 'x');
    else
      perform public.notify(new.owner_id, 'bookings', 'إلغاء حجز في ' || h,
        public.person_name(new.player_id) || ' ألغى ' || coalesce(at, ''), '#/desk/hall', 'x', 'hbx:' || new.hall_id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists hall_bookings_alert on public.hall_bookings;
create trigger hall_bookings_alert after insert or update of status on public.hall_bookings
  for each row execute function public.alert_hall_booking();

create or replace function public.alert_training_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare at text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select public.cairo_time(starts_at) into at from public.training_slots where id = new.slot_id;
  if new.status = 'booked' then
    perform public.notify(new.trainer_id, 'bookings', 'حجز تدريب جديد',
      public.person_name(new.player_id) || ' حجز حصة ' || coalesce(at, ''), '#/desk/trainer', 'coach', 'tb:' || new.trainer_id);
  elsif new.status = 'cancelled' then
    if auth.uid() = new.trainer_id then
      perform public.notify(new.player_id, 'bookings', 'ألغى المدرب حصتك', 'حصة ' || coalesce(at, '') || '. احجز موعداً آخر.', '#/training', 'x');
    else
      perform public.notify(new.trainer_id, 'bookings', 'إلغاء حصة تدريب',
        public.person_name(new.player_id) || ' ألغى حصة ' || coalesce(at, ''), '#/desk/trainer', 'x', 'tbx:' || new.trainer_id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists bookings_alert on public.bookings;
create trigger bookings_alert after insert or update of status on public.bookings
  for each row execute function public.alert_training_booking();

------------------------------------------------------------- triggers: shop

create or replace function public.alert_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(new.seller_id, 'orders', 'طلب شراء جديد 🛒',
      public.person_name(new.buyer_id) || ' طلب ' || new.qty || ' × ' || new.product_name, '#/desk/seller', 'cart', 'ord:' || new.seller_id);
  elsif new.status is distinct from old.status then
    if auth.uid() = new.buyer_id and new.status = 'cancelled' then
      perform public.notify(new.seller_id, 'orders', 'أُلغي طلب',
        public.person_name(new.buyer_id) || ' ألغى طلب ' || new.product_name, '#/desk/seller', 'x');
    elsif new.status in ('confirmed', 'delivered', 'cancelled') then
      perform public.notify(new.buyer_id, 'orders',
        case new.status when 'confirmed' then 'تم تأكيد طلبك ✅' when 'delivered' then 'تم تسليم طلبك 📦' else 'أُلغي طلبك' end,
        new.product_name, '#/me', case new.status when 'cancelled' then 'x' else 'cart' end);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists orders_alert on public.orders;
create trigger orders_alert after insert or update of status on public.orders
  for each row execute function public.alert_order();

create or replace function public.alert_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved and (tg_op = 'INSERT' or old.approved) then
    perform public.notify_admins('products', 'منتج ينتظر الموافقة',
      new.name || ' من ' || public.person_name(new.seller_id), '#/admin/approvals', 'shop', 'prodq');
  elsif tg_op = 'UPDATE' and new.approved and not old.approved then
    perform public.notify(new.seller_id, 'products', 'تمت الموافقة على منتجك ✅',
      new.name || ' ظاهر الآن في المتجر.', '#/shop/p/' || new.id, 'check');
  end if;
  return null;
end;
$$;
drop trigger if exists products_alert on public.products;
create trigger products_alert after insert or update on public.products
  for each row execute function public.alert_product();

-- A new or changed promotion of a visible shop: its followers hear once per promotion.
create or replace function public.alert_shop_promo() returns trigger
language plpgsql security definer set search_path = public as $$
declare f uuid; k text;
begin
  if new.promo_title is null or not new.active or new.hidden then return null; end if;
  if new.promo_until is not null and new.promo_until < current_date then return null; end if;
  if tg_op = 'UPDATE' and new.promo_title is not distinct from old.promo_title and new.promo_pct is not distinct from old.promo_pct
     and new.promo_until is not distinct from old.promo_until and old.active and not old.hidden then return null; end if;
  k := 'promo:' || new.owner_id || ':' || md5(coalesce(new.promo_title, '') || coalesce(new.promo_pct::text, '') || coalesce(new.promo_until::text, ''));
  for f in select user_id from public.shop_follows where shop_id = new.owner_id loop
    perform public.notify(f, 'promos', 'عرض جديد من ' || new.name || ' 🎁',
      new.promo_title || case when new.promo_pct is not null then ' – خصم ' || new.promo_pct || '% للاعبي بينجو' else '' end,
      '#/shops/' || new.owner_id, 'gift', k, true);
  end loop;
  return null;
end;
$$;
drop trigger if exists shops_alert on public.shops;
create trigger shops_alert after insert or update on public.shops
  for each row execute function public.alert_shop_promo();

------------------------------------------------------------- triggers: roles

create or replace function public.alert_role_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.created_at is not distinct from old.created_at then return null; end if;
  if new.status = 'pending' then
    perform public.notify_admins('roles', 'طلب دور جديد',
      public.person_name(new.user_id) || ' يطلب أن يكون ' || public.role_ar(new.role), '#/admin/approvals', 'star', 'roleq');
  elsif new.status = 'approved' then
    perform public.notify(new.user_id, 'roles', 'تمت الموافقة: أنت الآن ' || public.role_ar(new.role) || ' 🎉',
      'أدواتك جاهزة في «مساحتي» أعلى الصفحة.', '#/desk', 'star');
  elsif new.status = 'rejected' then
    perform public.notify(new.user_id, 'roles', 'لم تتم الموافقة على طلب ' || public.role_ar(new.role),
      'للاستفسار كلّمنا على واتساب من زر المساعدة.', '#/me', 'x');
  end if;
  return null;
end;
$$;
drop trigger if exists role_requests_alert on public.role_requests;
create trigger role_requests_alert after insert or update on public.role_requests
  for each row execute function public.alert_role_request();

------------------------------------------------------------- grants

revoke all on function public.notify(uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.notify_admins(text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.push_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.daily_alerts() from public, anon, authenticated;
revoke all on function public.by_player(uuid) from public, anon, authenticated;
revoke all on function public.person_name(uuid) from public, anon, authenticated;
revoke all on function public.pay_label(text, text) from public, anon, authenticated;
revoke all on function public.notifications_unread() from public, anon;
revoke all on function public.notifications_read(uuid[]) from public, anon;
revoke all on function public.notifications_clear() from public, anon;
revoke all on function public.notifications_refresh() from public, anon;
revoke all on function public.set_notification_prefs(text[], text[]) from public, anon;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.tournament_contacts(text) from public, anon;
grant execute on function public.notifications_unread() to authenticated;
grant execute on function public.notifications_read(uuid[]) to authenticated;
grant execute on function public.notifications_clear() to authenticated;
grant execute on function public.notifications_refresh() to authenticated;
grant execute on function public.set_notification_prefs(text[], text[]) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.tournament_contacts(text) to authenticated;
grant execute on function public.shop_followers(uuid) to anon, authenticated;
grant execute on function public.daily_alerts() to service_role;
