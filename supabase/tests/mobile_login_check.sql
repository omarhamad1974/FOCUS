-- Manual check of mobile sign-in (0014). Run after supabase_shim.sql and all migrations on a throwaway
-- database, with: create schema extensions; create extension pgcrypto schema extensions;
-- alter table auth.users add column encrypted_password text;   Lines marked "expect error" must fail.
\set ON_ERROR_STOP 0
select norm_mobile('+20 100 655 2256') = '01006552256' as eg_plus, norm_mobile('٠١٠٠٦٥٥٢٢٥٦') = '01006552256' as arabic_digits,
  norm_mobile('1006552256') = '01006552256' as no_zero, norm_mobile('971501234567') as uae, norm_mobile('abc') is null as bad;

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a9','admin@x.com','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000b3','real@x.com','{"full_name":"Email Player","phone":"0100 111 2222"}'),
 ('00000000-0000-0000-0000-0000000000c3','01223334444@phone.pingo.example','{"full_name":"Mobile Player","phone":"01223334444"}');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a9';

-- The Edge Function looks a mobile up before making an account
select account_by_mobile('+201223334444') = '00000000-0000-0000-0000-0000000000c3' as by_login,
  account_by_mobile('01001112222') = '00000000-0000-0000-0000-0000000000b3' as by_profile_phone,
  account_by_mobile('01009999999') is null as none;

-- A directory player without an account gets a mobile account and keeps their tournaments
insert into players (id, full_name) values ('00000000-0000-0000-0000-0000000000e3', 'Typed Player');
insert into tournaments (id, organizer_id, name, status, state) values
 ('t3', '00000000-0000-0000-0000-0000000000a9', 'Cup', 'registration', '{"players":[{"id":"p1","name":"Typed Player","directoryId":"00000000-0000-0000-0000-0000000000e3"}]}');
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
 ('00000000-0000-0000-0000-0000000000d3','01005556666@phone.pingo.example','{"full_name":"Typed Player","phone":"01005556666"}', 'x');
select setup_mobile_player('00000000-0000-0000-0000-0000000000d3', '01005556666', 'Club', 'female', 2004, '00000000-0000-0000-0000-0000000000e3') = '00000000-0000-0000-0000-0000000000e3' as linked_row;
select phone, club, gender, birth_year, must_change_password from profiles where id = '00000000-0000-0000-0000-0000000000d3';
select encrypted_password = extensions.crypt('pingo123', encrypted_password) as password_is_pingo from auth.users where id = '00000000-0000-0000-0000-0000000000d3';
select state -> 'players' -> 0 ->> 'accountId' = '00000000-0000-0000-0000-0000000000d3' as in_tournament from tournaments where id = 't3';
select count(*) = 1 as one_row, max(phone) as phone from players where profile_id = '00000000-0000-0000-0000-0000000000d3';

-- A brand-new account gets its own directory row
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000f3','01117778888@phone.pingo.example','{"full_name":"New One"}');
select setup_mobile_player('00000000-0000-0000-0000-0000000000f3', '1117778888') is not null as new_row;
select full_name, phone from players where profile_id = '00000000-0000-0000-0000-0000000000f3';

-- The player changes their password: reminder off. Only service role may set up or reset accounts.
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d3';
select setup_mobile_player('00000000-0000-0000-0000-0000000000d3', '01005556666'); -- expect error
select reset_default_password('00000000-0000-0000-0000-0000000000a9'); -- expect error
select account_by_mobile('01005556666'); -- expect error
update profiles set must_change_password = false where id = '00000000-0000-0000-0000-0000000000d3'; -- expect error
select password_changed();
select must_change_password as still_must from profiles where id = '00000000-0000-0000-0000-0000000000d3';
reset role;

-- Admin reset brings back "pingo123" and the reminder
select reset_default_password('00000000-0000-0000-0000-0000000000d3');
select must_change_password as must_again from profiles where id = '00000000-0000-0000-0000-0000000000d3';
select setup_mobile_player('00000000-0000-0000-0000-0000000000d3', 'nope'); -- expect error
