-- Name required (migration 0023). Run after the migrations on plain Postgres (supabase_shim.sql).
-- Expected: the first insert works; the next three fail with "full_name required";
-- clearing or replacing the name with digits fails on the check; a real new name works.
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1','01001112222@phone.pingo.example','{"full_name":"  سارة   علي "}');
select 'name kept, spaces tidied', full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000e1';
insert into auth.users values ('00000000-0000-0000-0000-0000000000e2','01003334444@phone.pingo.example','{}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000e3','01005556666@phone.pingo.example','{"full_name":"   "}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000e4','01007778888@phone.pingo.example','{"full_name":"01007778888"}');
select 'refused accounts made', count(*) from auth.users where id in ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e4');
update public.profiles set full_name = ' ' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set full_name = '0100 111 2222' where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.players (full_name) values ('123');
update public.profiles set full_name = 'Sara Ali' where id = '00000000-0000-0000-0000-0000000000e1';
select 'renamed', full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000e1';
select 'rule', public.is_real_name('أحمد'), public.is_real_name('Ahmed'), public.is_real_name('ع'), public.is_real_name('٠١٠٠١٢٣٤٥٦٧'), public.is_real_name(null);
