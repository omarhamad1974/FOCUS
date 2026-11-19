-- Minimal stand-in for the Supabase auth schema so the migrations can be tested on plain Postgres.
-- Like new Supabase projects, nothing is granted to anon/authenticated by default.
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
revoke execute on functions from public;
alter default privileges revoke execute on functions from public;
