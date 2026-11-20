-- Manual check of admin batch players with temporary accounts (0011). Run after supabase_shim.sql
-- and all migrations on a throwaway database. Lines marked "expect error" must fail.
\set ON_ERROR_STOP 0
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a9','admin@x.com','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000a2','org@x.com','{"full_name":"Org"}'),
 ('00000000-0000-0000-0000-0000000000b2','real@x.com','{"full_name":"Real Player","gender":"female"}');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a9';
update profiles set is_organizer = true where id = '00000000-0000-0000-0000-0000000000a2';
insert into tournaments (id, organizer_id, name, status, state) values
 ('t2', '00000000-0000-0000-0000-0000000000a2', 'Open', 'registration', '{"players":[]}');

-- What the Edge Function does for a batch of 3 names (service role = no jwt here)
select name, kind from batch_match_names(array['Temp One', 'Real Player', 'Temp Two']);
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000c2','tmp-1@temp.pingo.example','{"full_name":"Temp One"}'),
 ('00000000-0000-0000-0000-0000000000d2','tmp-2@temp.pingo.example','{"full_name":"Temp Two"}');
select setup_temp_player('00000000-0000-0000-0000-0000000000c2', 'Club', 'male') ~ '^[A-Z2-9]{8}$' as code1;
select setup_temp_player('00000000-0000-0000-0000-0000000000d2', null, null) ~ '^[A-Z2-9]{8}$' as code2;
select full_name, is_temp, club, gender from profiles where is_temp order by full_name;
select full_name, profile_id is not null as linked from players order by full_name;
select waitlist_add('t2', array['00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000b2']::uuid[]) as added;
select waitlist_add('t2', array['00000000-0000-0000-0000-0000000000c2']::uuid[]) as added_again;
-- same names again now match the temporary accounts
select name, kind, claim_code is not null as has_code from batch_match_names(array['temp one', 'Real Player', 'Nobody']);

-- the organizer sees the waiting list and approves
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a2';
select count(*) as org_sees_pending from registrations where tournament_id = 't2' and status = 'pending';
update registrations set status = 'approved' where tournament_id = 't2';
select player_for_profile('00000000-0000-0000-0000-0000000000c2') = (select id from players where full_name = 'Temp One') as same_directory_row;
-- only the admin may use the app-side waiting list function
select admin_waitlist_add('t2', array['00000000-0000-0000-0000-0000000000b2']::uuid[]); -- expect error
select renew_claim_code('00000000-0000-0000-0000-0000000000c2'); -- expect error
select * from batch_add_players(array['x']); -- expect error
select waitlist_add('t2', array[]::uuid[]); -- expect error (service only)
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a9';
select admin_waitlist_add('t2', array['00000000-0000-0000-0000-0000000000b2']::uuid[]) as admin_added_existing;
select renew_claim_code('00000000-0000-0000-0000-0000000000c2') ~ '^[A-Z2-9]{8}$' as admin_renewed;

-- anyone can look the code up
reset role;
create temp table codes as select full_name, claim_code from profiles where is_temp;
grant select on codes to anon, authenticated;
set role anon; reset request.jwt.claim.sub;
select full_name, club, gender, tournaments from claim_info((select lower(claim_code) from codes where full_name = 'Temp One'));

-- Temp One completes registration (Edge Function: same account gets email + password)
reset role;
select temp_account_for((select claim_code from codes where full_name = 'Temp One')) = '00000000-0000-0000-0000-0000000000c2' as found;
select finish_temp_account('00000000-0000-0000-0000-0000000000c2', 'female');
select is_temp, claim_code is null as code_cleared, gender from profiles where id = '00000000-0000-0000-0000-0000000000c2';
select count(*) as used_code from claim_info((select claim_code from codes where full_name = 'Temp One'));

-- Real Player, signed in, takes Temp Two's code: merged into her account
update tournaments set state = '{"players":[{"id":"x","name":"Temp Two","profileId":"00000000-0000-0000-0000-0000000000d2","accountId":"00000000-0000-0000-0000-0000000000d2"}]}' where id = 't2';
insert into tournaments (id, organizer_id, name, status, state) values ('t3', '00000000-0000-0000-0000-0000000000a2', 'T3', 'registration', '{"players":[]}');
select waitlist_add('t3', array['00000000-0000-0000-0000-0000000000d2']::uuid[]);
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a9';
select claim_player((select claim_code from codes where full_name = 'Temp Two')); -- expect error (admin)
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b2';
select claim_player((select claim_code from codes where full_name = 'Temp Two')) is not null as merged;
reset role;
select tournament_id, status from registrations where player_id = '00000000-0000-0000-0000-0000000000b2' order by 1;
select count(*) as temp_regs_left from registrations where player_id = '00000000-0000-0000-0000-0000000000d2';
select state -> 'players' -> 0 ->> 'profileId' = '00000000-0000-0000-0000-0000000000b2' as t_profile,
       state -> 'players' -> 0 ->> 'accountId' = '00000000-0000-0000-0000-0000000000b2' as t_account from tournaments where id = 't2';
select merged_into is not null as temp_merged, is_temp from profiles where id = '00000000-0000-0000-0000-0000000000d2';
select name, kind from batch_match_names(array['Temp Two']);
