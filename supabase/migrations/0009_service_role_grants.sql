-- Let the server-side key (used only inside the admin-users Edge Function) read and
-- change tables. Newer Supabase projects do not grant this automatically, so without
-- it every account action in the function (confirm, create, bulk delete) failed with
-- "permission denied" and the admin saw «حدث خطأ». The key never reaches the browser.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Tables and functions added by later migrations get the same rights.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
