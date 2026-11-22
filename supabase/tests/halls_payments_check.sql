-- Manual check of halls and payments (0017). Run after supabase_shim.sql and all migrations on a throwaway database.
-- Lines marked "expect error" must fail.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','a@x.com','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000c1','h@x.com','{"full_name":"Hall","wants":"hall"}'),
 ('00000000-0000-0000-0000-0000000000d1','p1@x.com','{"full_name":"P1"}'),
 ('00000000-0000-0000-0000-0000000000d2','p2@x.com','{"full_name":"P2"}');
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';
select role, status from role_requests; -- hall pending
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
update profiles set is_hall = true where id = auth.uid(); -- expect error (only admin)
insert into halls (name, tables, price_hour) values ('Hall A', 4, 100); -- expect error (no role yet)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select decide_role_request((select id from role_requests where role='hall'), true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select is_hall();
insert into pay_settings (accepts_wallet, wallets, whatsapp, cancel_hours) values (true, '[{"kind":"instapay","number":"01000000000"}]', '01000000000', 24);
insert into halls (id, name, tables, price_hour) values ('00000000-0000-0000-0000-00000000f001','Hall A', 4, 100);
insert into hall_slots (hall_id, table_no, starts_at) values
  ('00000000-0000-0000-0000-00000000f001', 1, now() + interval '3 days'),
  ('00000000-0000-0000-0000-00000000f001', 2, now() + interval '2 hours');
insert into hall_slots (hall_id, table_no, starts_at) values ('00000000-0000-0000-0000-00000000f001', 9, now()); -- expect error (table 9 of 4)
-- two players ask for the same hour
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select book_hall_slots(array(select id from hall_slots where table_no = 1)); -- 1
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select book_hall_slots(array(select id from hall_slots)); -- 2
select * from hall_slot_requests('00000000-0000-0000-0000-00000000f001') order by requests;
select submit_payment('hall', (select id::text from hall_bookings where player_id = auth.uid() and slot_id = (select id from hall_slots where table_no=1)), 'wallet', 'instapay', '00000000-0000-0000-0000-0000000000d2/r.jpg') is not null;
select submit_payment('hall', (select id::text from hall_bookings where player_id = '00000000-0000-0000-0000-0000000000d1'), 'cash'); -- expect error (not visible / not payer)
select count(*) from hall_bookings; -- 2 (own only)
-- owner approves P2's payment: P2 confirmed, P1 turned down
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select decide_payment((select id from payments), true);
select s.table_no, right(b.player_id::text, 2) who, b.status, b.paid from hall_bookings b join hall_slots s on s.id = b.slot_id order by 1, 2; -- table 1: d1 rejected, d2 confirmed paid
select taken from hall_slots order by table_no;
-- owner confirms the 2-hour slot without a receipt; player cannot cancel it inside 24 h
select decide_hall_booking((select b.id from hall_bookings b join hall_slots s on s.id=b.slot_id where s.table_no=2), true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select cancel_hall_booking((select b.id from hall_bookings b join hall_slots s on s.id=b.slot_id where s.table_no=2)); -- expect error (deadline)
select cancel_hall_booking((select b.id from hall_bookings b join hall_slots s on s.id=b.slot_id where s.table_no=1)); -- ok, 3 days away
select taken from hall_slots order by table_no; -- f, t
-- tournament fee + withdraw deadline
reset role;
select set_config('request.jwt.claim.sub','',false);
update profiles set is_organizer = true where id = '00000000-0000-0000-0000-0000000000c1';
insert into tournaments (id, organizer_id, name, status, date, state) values ('t1','00000000-0000-0000-0000-0000000000c1','T','registration', current_date, '{"fee":200,"time":"23:59"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select join_tournament('t1');
select submit_payment('tournament', (select registration_id::text from my_registration('t1')), 'cash');
select amount, method, status from payments where kind='tournament';
select withdraw_from_tournament('t1'); -- expect error (deadline: 24 h before today 23:59)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select registration_id is not null, paid, pay_status, method from tournament_payments('t1');
select set_paid('tournament', (select registration_id::text from tournament_payments('t1')), true);
select paid, pay_status from tournament_payments('t1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2',false);
select set_paid('tournament', (select id::text from registrations limit 1), true); -- expect error
select (admin_counts()) is null;
