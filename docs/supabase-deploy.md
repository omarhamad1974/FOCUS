# Database and Edge Functions from GitHub

Pingo's database schema lives in `supabase/migrations/` and the `admin-users` Edge Function in
`supabase/functions/`. The **Supabase** GitHub Actions workflow (`.github/workflows/supabase.yml`)
puts them live, so nobody pastes SQL into the SQL Editor or redeploys functions by hand any more.

| When | What happens |
| --- | --- |
| A pull request changes anything in `supabase/` | **Check migrations on a fresh database**: a throwaway Supabase database is started inside GitHub and every migration is applied in order. A broken migration fails the check before it can be merged. Nothing touches the live project. |
| The pull request is merged into `main` | **Apply migrations and deploy functions to live**: migrations the live project has not had yet are applied (`supabase db push`), then `admin-users` is deployed. Migrations already applied are never run again. |
| You press **Run workflow** on the Actions tab (branch `main`) | The same deploy, for example after adding the secrets. |

Demo content (`supabase/seed/`) is never applied automatically.

## One-time setup: add three secrets (about 5 minutes)

The deploy needs to sign in to Supabase. You give it that access as GitHub **repository secrets**.
Secrets are encrypted; nobody can read them back, not even you, and they never appear in logs.

### 1. Make a Supabase access token

1. Open <https://supabase.com/dashboard/account/tokens> (signed in to Supabase).
2. Click **Generate new token**, name it `GitHub Pingo`, choose an expiry (or "never"), and click **Generate token**.
3. Copy the token (it starts with `sbp_`). It is shown only once.

### 2. Find the database password

This is the password you chose when you created the Supabase project.

If you don't have it: open the project in Supabase, go to **Project Settings → Database**, and click
**Reset database password**. Copy the new password. Resetting it does not affect the app: the app
uses its API key, not this password.

### 3. Add the secrets to GitHub

1. Open <https://github.com/omarhamad1974/FOCUS/settings/secrets/actions>
   (repository **Settings → Secrets and variables → Actions**).
2. Click **New repository secret** and add each of these, one at a time:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token from step 1 |
   | `SUPABASE_DB_PASSWORD` | the database password from step 2 |
   | `SUPABASE_PROJECT_REF` | `xjfttraweunhwxlgeagz` |

   `SUPABASE_PROJECT_REF` is optional (the workflow already uses Pingo's project), but adding it
   makes the setting visible in one place.

### 4. Run it once

1. Open <https://github.com/omarhamad1974/FOCUS/actions/workflows/supabase.yml>.
2. Click **Run workflow**, keep branch `main`, click the green **Run workflow** button.
3. After 1 to 2 minutes the run shows a green tick. The step **Migration history now** lists
   `0001` to `0014` as applied on the live project.

If it fails at **Check secrets**, one of the secret names is misspelled. If it fails at **Link the
live project**, the token or database password is wrong: add the secret again with the same name to
replace it.

## The first run and the hand-run history

Migrations `0001`–`0014` were run by hand in the SQL Editor before this workflow existed. On
2026-11-22 the live database was compared with a fresh database built from these files: tables,
columns, functions, policies, views, triggers, indexes, constraints and the image bucket are the same.

So the first deploy does not run them again. The step **Baseline migration history** only records
them as applied in Supabase's migration history table (and removes two duplicate entries that had
been recorded under timestamp versions). It is safe to repeat and changes no data or schema.

## Adding a database change from now on

1. Add a new file in `supabase/migrations/` with the next number, for example
   `0015_player_stats.sql`. Never edit a migration that is already live; add a new one instead.
2. Write it so it is safe on the live data: `create table if not exists`, `add column if not exists`,
   `create or replace function`, `drop policy if exists` before `create policy`.
3. New tables need explicit grants: this project does **not** give `anon`/`authenticated` access to
   new tables automatically (the local check database does, so the check will not catch a missing grant).
4. Open a pull request. The check applies all migrations to a fresh database.
5. Merge. The deploy applies the new file to the live project and redeploys `admin-users`.

Do not apply migrations through the Supabase dashboard or other tools any more: an entry that is
not a file in `supabase/migrations/` makes the next deploy stop with "Remote migration versions not
found in local migrations directory".

## Try it on your own computer (optional)

With Docker and the Supabase CLI installed: `supabase db start` builds the same local database as
the pull-request check.
