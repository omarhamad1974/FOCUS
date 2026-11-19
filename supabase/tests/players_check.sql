-- Manual check of the player directory (after rls_check.sql). ERROR lines are expected refusals.
-- organizer (admin a) adds typed player, links to p1 (b)
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into players(full_name, phone) values ('Typed Lina', '0101') returning full_name;
select 'auto row for p1', player_for_profile('00000000-0000-0000-0000-00000000000b') is not null;
select link_player((select id from players where full_name='Typed Lina'), '00000000-0000-0000-0000-00000000000b');
select full_name, profile_id is not null as linked, merged_into is not null as merged from players order by created_at;
-- player p1 can only see own row, cannot insert
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'p1 sees players', count(*) from players;
insert into players(full_name) values ('x');
select player_for_profile('00000000-0000-0000-0000-00000000000b');
-- anon directory
reset role; set role anon; reset request.jwt.claim.sub;
select * from player_directory where profile_id='00000000-0000-0000-0000-00000000000b';
select count(*) from players;
