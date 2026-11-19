-- Manual check of roles, news, shop and training (run after the migrations on a fresh database).
-- Lines marked "expect error" must fail; psql continues because ON_ERROR_STOP is off.
\set A '00000000-0000-0000-0000-0000000000a1'
\set S '00000000-0000-0000-0000-0000000000a2'
\set P '00000000-0000-0000-0000-0000000000a3'
insert into auth.users values (:'A', 'admin@x', '{"full_name":"Admin"}'),
  (:'S', 'coach@x', '{"full_name":"Coach Sami","wants":"seller,trainer","birth_year":""}'),
  (:'P', 'p@x', '{"full_name":"Player Mona","phone":"0100"}');
update profiles set role = 'admin' where id = :'A';
select 'requests from sign-up', count(*) from role_requests where user_id = :'S';

-- Player tries to self-promote (expect error), then requests trainer role.
set role authenticated; set request.jwt.claim.sub = :'P';
update profiles set is_seller = true where id = :'P';
select request_role('trainer', 'coach');
select decide_role_request((select id from role_requests where user_id = :'P'), true);
select 'player sees own requests only', count(*) from role_requests;
-- Admin approves Sami's two requests.
reset role; set role authenticated; set request.jwt.claim.sub = :'A';
select decide_role_request(id, true) from role_requests where user_id = :'S';
select 'sami roles', is_seller, is_trainer from profiles where id = :'S';

-- News: admin writes; player cannot (expect error); anon reads.
insert into posts (title, body, category) values ('Hello', 'text', 'news');
insert into posts (title, body, published) values ('Draft', 'x', false);
reset role; set role authenticated; set request.jwt.claim.sub = :'P';
insert into posts (title, body) values ('nope', 'x');
reset role; set role anon; reset request.jwt.claim.sub;
select 'anon sees published only', count(*) from posts;

-- Shop: Sami sells; player orders; stock moves; player cannot set delivered (expect error).
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
insert into products (name, price, stock, category) values ('Racket X', 1500, 2, 'rackets');
select place_order((select id from products), 1, '', '');
reset role; set role authenticated; set request.jwt.claim.sub = :'P';
insert into products (name, price) values ('nope', 1);
select place_order((select id from products), 3, '0100', 'note');
select place_order((select id from products), 2, '0100', 'note') is not null as ordered;
select 'stock after order', stock from products;
select set_order_status((select id from orders), 'delivered');
select set_order_status((select id from orders), 'cancelled');
select 'stock after cancel', stock, (select status from orders) from products;

-- Training: Sami adds a location and a slot; player books; second booking fails (expect error).
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
insert into training_locations (name, address) values ('Club Hall', 'Cairo');
insert into training_slots (location_id, starts_at, price) values ((select id from training_locations), now() + interval '1 day', 300);
update training_slots set booked = true;
reset role; set role authenticated; set request.jwt.claim.sub = :'P';
select book_slot((select id from training_slots), 'first time') is not null as booked;
select book_slot((select id from training_slots));
select 'player sees booking', count(*) from bookings;
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
select 'trainee', full_name, phone from my_trainees();
delete from training_slots;
select 'slot kept while booked', count(*) from training_slots;
select cancel_booking((select id from bookings));
select 'slot free again', booked from training_slots;
reset role; set role anon;
select 'anon reads slots', count(*) from training_slots;
select 'anon cannot read bookings', count(*) from bookings;
