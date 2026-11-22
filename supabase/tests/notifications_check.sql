-- Manual check of notifications (0020). Run after supabase_shim.sql and all migrations on a throwaway database.
-- Lines marked "expect error" must fail. Comments say what each select should show.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','a@x.com','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000b1','o@x.com','{"full_name":"Org"}'),
 ('00000000-0000-0000-0000-0000000000c1','s@x.com','{"full_name":"Seller","wants":"seller"}'),
 ('00000000-0000-0000-0000-0000000000d1','01011111111@phone.pingo.example','{"full_name":"P1"}'),
 ('00000000-0000-0000-0000-0000000000d2','p2@x.com','{"full_name":"P2"}');
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';
update profiles set is_organizer=true where id='00000000-0000-0000-0000-0000000000b1';
select right(user_id::text,2) who, kind, title from notifications order by created_at; -- a1 roles: طلب دور جديد (Seller)

insert into tournaments (id, organizer_id, name, status, max_players, state) values
 ('t1','00000000-0000-0000-0000-0000000000b1','Cup','registration', 2,
  '{"players":[{"id":"x1","name":"P1","profileId":"00000000-0000-0000-0000-0000000000d1"},{"id":"x2","name":"P2","profileId":"00000000-0000-0000-0000-0000000000d2"}],
    "matches":{"m1":{"id":"m1","aId":"x1","bId":"x2","bestOf":3,"games":[],"walkover":null}}}');

set role authenticated;
-- players join; organizer hears (folded into one row, count 2), then "full" once
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select join_tournament('t1');
select notifications_unread(); -- 0 (own list empty)
select count(*) from notifications; -- 0 (cannot see others')
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select join_tournament('t1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select kind, title, count from notifications order by created_at; -- requests x2 (count 2), capacity "اكتمل العدد" once
select notifications_unread(); -- 2
-- organizer approves P1, rejects P2
update registrations set status='approved', decided_at=now() where player_id='00000000-0000-0000-0000-0000000000d1';
update registrations set status='rejected', decided_at=now() where player_id='00000000-0000-0000-0000-0000000000d2';
select * from tournament_contacts('t1'); -- P1 with mobile 01011111111
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select * from tournament_contacts('t1'); -- expect error (not the organizer)
select kind, title from notifications; -- entries: تم قبولك
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select kind, title from notifications; -- entries: لم يتم قبولك
-- P2 switches "entries" off in the app: nothing more of that type
select set_notification_prefs('{entries}', '{}');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
update registrations set status='approved' where player_id='00000000-0000-0000-0000-0000000000d2';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select count(*) from notifications; -- 1 (still only the rejection)
-- result entered: both players hear once, a correction does not alert again
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
update tournaments set status='running', state = jsonb_set(state, '{matches,m1,result}', '{"a":2,"b":1}') where id='t1';
update tournaments set state = jsonb_set(state, '{matches,m1,result}', '{"a":2,"b":0}') where id='t1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select kind, title, body from notifications where kind='results' order by created_at; -- القرعة جاهزة + فزت 2-1 ضد P2
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select kind, title from notifications where kind='results' order by created_at; -- القرعة جاهزة + نتيجة مباراتك: 1-2
-- read / clear
select notifications_read(null);
select notifications_unread(); -- 0
select notifications_clear();
select count(*) from notifications; -- 0
-- invitations
reset role;
insert into tournaments (id, organizer_id, name, status, state) values ('t2','00000000-0000-0000-0000-0000000000b1','Open','registration','{}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select invite_players('t2', array['00000000-0000-0000-0000-0000000000d1']::uuid[]);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select kind, title from notifications where kind='invites'; -- دعوة للمشاركة في Open
select answer_invitation((select id from invitations where tournament_id='t2'), false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select title from notifications where kind='requests' and link like '%t2'; -- اعتذار عن دعوة Open
-- role request decided, product approval, shop promo to followers
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select decide_role_request((select id from role_requests where role='seller'), true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select title from notifications; -- تمت الموافقة: أنت الآن بائع
insert into products (name, price) values ('Racket', 500);
insert into shops (name) values ('Shop C');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select title, body from notifications where kind='products'; -- منتج ينتظر الموافقة
update products set approved = true;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
insert into shop_follows (shop_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into shop_follows (user_id, shop_id) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1'); -- expect error (not own)
select shop_followers('00000000-0000-0000-0000-0000000000c1'); -- 1
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select title from notifications where kind='products'; -- تمت الموافقة على منتجك
update shops set promo_title = 'Winter sale', promo_pct = 15;
update shops set about = 'x';  -- no second alert
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select title, body from notifications where kind='promos'; -- one: عرض جديد من Shop C, Winter sale – خصم 15%
-- orders and payments
select place_order((select id from products), 1, '0100', null) is not null;
select submit_payment('order', (select id::text from orders), 'wallet', 'instapay', 'demo') is not null;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select kind, title from notifications where kind in ('orders','payments') order by created_at; -- طلب شراء جديد, إيصال دفع جديد
select decide_payment((select id from payments), true);
select set_order_status((select id from orders), 'confirmed');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select kind, title from notifications where kind in ('orders','payments') order by created_at; -- تم تأكيد دفعك, تم تأكيد طلبك
-- push: a device, then alerts are only queued for push when pg_net and the function endpoint exist
select save_push_subscription('https://push.example/abc', 'k', 'a', 'test');
select count(*) from push_subscriptions; -- 1
select remove_push_subscription('https://push.example/abc');
select count(*) from push_config; -- expect error (hidden)
-- subscriptions ending soon: once for the person and the admin
reset role;
insert into subscriptions (user_id, role, plan, amount, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000b1', 'organizer', 'monthly', 500, current_date - 25, current_date + 5);
select daily_alerts(); select daily_alerts();
select right(user_id::text,2), title from notifications where kind='roles' and key like 'subend%'; -- b1 + a1, once each
select notify('00000000-0000-0000-0000-0000000000d1', 'nonsense', 'x'); -- no error (bad kind is swallowed)
