-- Manual check of directory claim codes (0008; batch entry moved to temporary accounts in 0011,
-- see temp_accounts_check.sql). Run after supabase_shim.sql and all migrations
-- on a throwaway database. Lines marked "expect error" must fail.
\set ON_ERROR_STOP 0
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1','org@x.com','{"full_name":"Org"}'),
 ('00000000-0000-0000-0000-0000000000b1','p@x.com','{"full_name":"Player","gender":"male"}'),
 ('00000000-0000-0000-0000-0000000000c1','new@x.com','{"full_name":"سارة"}');
update profiles set is_organizer = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into players (full_name, profile_id) values ('Player', '00000000-0000-0000-0000-0000000000b1');

-- directory players with codes, as made by the 0008 batch
insert into players (full_name, club, gender, claim_code) values
 ('أحمد علي', 'نادي الزمالك', 'female', new_claim_code()), ('سارة', 'نادي الزمالك', 'female', new_claim_code());
-- organizers can no longer use the batch (admin only, 0011)
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
select * from batch_add_players(array['x']); -- expect error (admin only)

-- a tournament that uses سارة
reset role;
insert into tournaments (id, organizer_id, name, status, state) values ('t1', '00000000-0000-0000-0000-0000000000a1', 'T', 'running',
  jsonb_build_object('players', jsonb_build_array(
    jsonb_build_object('id', 'p1', 'name', 'سارة', 'directoryId', (select id from players where full_name = 'سارة')::text),
    jsonb_build_object('id', 'p2', 'name', 'أحمد علي'))));

-- anyone can look up a code (typed with dash and small letters)
create temp table sc as select lower(substr(claim_code,1,4) || '-' || substr(claim_code,5)) as typed from players where full_name = 'سارة';
grant select on sc to anon;
set role anon; reset request.jwt.claim.sub;
select full_name, club, gender, tournaments from claim_info((select typed from sc));
select count(*) as unknown_code from claim_info('ZZZZZZZZ');
select claim_player('ABCDEFGH'); -- expect error (anon)
select batch_add_players(array['x']); -- expect error (anon)

-- a plain player cannot add a batch or renew codes
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b1';
select * from batch_add_players(array['x']); -- expect error
select renew_claim_code((select id from players limit 1)); -- expect error (no access to row / not organizer)
select claim_player_for('ABCDEFGH', auth.uid()); -- expect error (service only)

-- the Edge Function claims سارة for the new account (service role = no jwt here)
reset role; reset request.jwt.claim.sub;
select claim_player_for((select claim_code from players where full_name = 'سارة'), '00000000-0000-0000-0000-0000000000c1') is not null as claimed;
select full_name, claim_code is null as code_cleared, profile_id = '00000000-0000-0000-0000-0000000000c1' as linked from players where full_name = 'سارة';
select club, gender from profiles where id = '00000000-0000-0000-0000-0000000000c1';
select state -> 'players' -> 0 ->> 'accountId' = '00000000-0000-0000-0000-0000000000c1' as tournament_linked,
       state -> 'players' -> 1 ? 'accountId' as other_untouched from tournaments where id = 't1';
-- used code no longer works
select count(*) as used_code from claim_info((select 'x'));

-- signed-in player claims أحمد علي; their own old row is merged into it
reset role; update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
select renew_claim_code((select id from players where full_name = 'Player')); -- expect error (already claimed)
select renew_claim_code((select id from players where full_name = 'أحمد علي')) ~ '^[A-Z2-9]{8}$' as renewed;
reset role;
create temp table c as select claim_code from players where full_name = 'أحمد علي';
grant select on c to authenticated;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b1';
select claim_player((select claim_code from c)) is not null as self_claimed;
select claim_player((select claim_code from c)); -- expect error (used)
reset role;
select full_name, profile_id is not null as linked, merged_into is not null as merged from players order by full_name;
