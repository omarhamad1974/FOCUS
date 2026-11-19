-- Manual check of 0006 (run on a fresh database after 0001–0004 and 0006). "expect error" lines must fail.
\set A '00000000-0000-0000-0000-0000000000b1'
\set S '00000000-0000-0000-0000-0000000000b2'
\set O '00000000-0000-0000-0000-0000000000b3'
\set H '00000000-0000-0000-0000-0000000000b4'
insert into auth.users values (:'A', 'a@x', '{"full_name":"Admin"}'), (:'S', 's@x', '{"full_name":"Seller"}'),
  (:'O', 'o@x', '{"full_name":"Org"}'), (:'H', 'h@x', '{"full_name":"Helper"}');
update profiles set role = 'admin' where id = :'A';
update profiles set is_seller = true where id = :'S';
update profiles set is_organizer = true where id = :'O';

-- News: organizer can no longer post (expect error); admin can.
set role authenticated; set request.jwt.claim.sub = :'O';
insert into posts (title) values ('org post');
reset role; set role authenticated; set request.jwt.claim.sub = :'A';
insert into posts (title) values ('admin post');

-- Products: seller adds (hidden until approved); cannot approve self (expect error).
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
insert into products (name, price) values ('Racket', 100);
insert into products (name, price, approved) values ('Sneaky', 1, true);
update products set approved = true;
reset role; set role anon; reset request.jwt.claim.sub;
select 'anon sees before approval', count(*) from products;
reset role; set role authenticated; set request.jwt.claim.sub = :'A';
update products set approved = true, featured = true;
reset role; set role anon;
select 'anon sees after approval', count(*), bool_and(featured) from products;
-- Seller renames: back to approval; price change alone keeps approval.
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
update products set price = 120;
select 'price change keeps approval', approved from products;
update products set name = 'Racket Pro';
select 'rename needs approval again', approved, featured from products;

-- Assistants: organizer O owns a running tournament and adds H.
reset role; set role authenticated; set request.jwt.claim.sub = :'O';
insert into tournaments (id, name, status, state) values ('t1', 'Cup', 'running',
  '{"name":"Cup","groups":[{"id":"g","playerIds":["p1","p2"],"manualOrder":["p1"]}],"matches":{"m1":{"games":[]}}}');
insert into tournament_assistants (tournament_id, user_id) values ('t1', :'H');
reset role; set role authenticated; set request.jwt.claim.sub = :'H';
select 'helper sees assignment', count(*) from tournament_assistants;
update tournaments set name = 'hack';
select 'direct update changed nothing', name from tournaments;
select assistant_save_state('t1', '{"name":"Cup","groups":[{"id":"g","playerIds":["p1","p2"],"manualOrder":[]}],"matches":{"m1":{"games":[{"a":11,"b":5}]}}}', 'running');
select 'result saved', state->'matches'->'m1'->'games' from tournaments;
select assistant_save_state('t1', '{"name":"Hacked","groups":[{"id":"g","playerIds":["p1","p2"],"manualOrder":[]}],"matches":{"m1":{"games":[]}}}', 'running');
select assistant_save_state('t1', '{"name":"Cup","groups":[{"id":"g","playerIds":["p2","p1"],"manualOrder":[]}],"matches":{"m1":{"games":[]}}}', 'running');
reset role; set role authenticated; set request.jwt.claim.sub = :'S';
select assistant_save_state('t1', '{}', 'running');
select 'non-admin counts', admin_counts();
reset role; set role authenticated; set request.jwt.claim.sub = :'A';
select 'admin counts', admin_counts() ->> 'pendingProducts', admin_counts() ->> 'users';
