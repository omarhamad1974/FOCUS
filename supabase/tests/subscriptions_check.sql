-- Manual check of subscriptions (0015). Run after supabase_shim.sql and all migrations on a throwaway database.
-- Lines marked "expect error" must fail.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','a@x.com','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000b1','o@x.com','{"full_name":"Org"}');
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select org_month from plan_settings;
update plan_settings set org_month = 1; -- no rows
insert into subscriptions (user_id, role, plan, amount, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000000b1','organizer','monthly',500,current_date,current_date+30); -- expect error
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
update plan_settings set org_month = 450 returning org_month;
insert into subscriptions (user_id, role, plan, amount, starts_on, ends_on, paid) values ('00000000-0000-0000-0000-0000000000b1','organizer','monthly',500,current_date,current_date+30,true) returning paid_at is not null, created_by;
insert into subscriptions (user_id, role, plan, amount, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000000b1','organizer','per_product',500,current_date,current_date+30); -- expect error
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select count(*) from subscriptions;
