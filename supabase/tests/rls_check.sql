-- Manual RLS check. Run after supabase_shim.sql and the migration on a throwaway database; read the output: every "ERROR" line is an expected refusal.
\set ON_ERROR_STOP 0
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','omar@x.com','{"full_name":"عمر حمد","phone":"0100"}'),
 ('00000000-0000-0000-0000-00000000000b','p1@x.com','{"full_name":"Lina","birth_year":"2005"}'),
 ('00000000-0000-0000-0000-00000000000c','p2@x.com','{"full_name":"Player Two"}'),('00000000-0000-0000-0000-00000000000d','p3@x.com','{"full_name":"Player Three"}');
select id, full_name, role, birth_year from profiles order by id;
-- bootstrap admin from SQL editor (no jwt)
update profiles set role='admin' where id=(select id from auth.users where email='omar@x.com');
-- player tries to self-promote
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
update profiles set role='admin' where id=auth.uid();
select 'p1 sees profiles', count(*) from profiles;
select 'p1 sees directory', count(*) from player_directory;
insert into tournaments(id,name,state,status) values('t0','hack','{}','registration');
-- admin creates tournament
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into tournaments(id,name,state,status,max_players) values('t1','كأس','{}','registration',2);
insert into tournaments(id,name,state) values('t2','draft','{}');
select 'admin sees profiles', count(*) from profiles;
-- p1 joins
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'p1 sees tournaments', count(*) from tournaments;
select join_tournament('t1');
insert into registrations(tournament_id, player_id, status) values ('t1', auth.uid(), 'approved');
update registrations set status='approved';
update tournaments set name='x' where id='t1';
select 'p1 tournament name', name from tournaments where id='t1';
-- p2 joins: full
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select join_tournament('t1');
select join_tournament('t2');
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select 'p3 join (expect full)', join_tournament('t1');
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'p2 sees regs', count(*) from registrations;
-- admin approves
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
update registrations set status='approved', decided_at=now() where tournament_id='t1';
update registrations set player_id='00000000-0000-0000-0000-00000000000c';
select 'reg', status from registrations;
-- anon
reset role; set role anon; reset request.jwt.claim.sub;
select 'anon regs (approved)', count(*) from registrations;
select 'anon profiles', count(*) from profiles;
select join_tournament('t1');
-- withdraw and rejoin
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select withdraw_from_tournament('t1');
select 'after withdraw', status from registrations;
select join_tournament('t1');
