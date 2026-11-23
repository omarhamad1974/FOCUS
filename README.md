# بينجو (Pingo)

Mobile-first table tennis tournament app. Arabic only, right-to-left. Runs offline with browser storage, or online with Supabase (accounts, saved tournaments, player registration).

## Run it

```bash
npm install
npm run dev      # open the printed URL (works on a phone on the same Wi-Fi with --host)
npm test         # standings, scoring, bracket and flow tests
npm run build    # static site in dist/
```

Pushing to `main` runs the tests and publishes `dist/` to GitHub Pages (enable Pages with "GitHub Actions" as the source in the repository settings).

## Connect Supabase

1. Create a project at supabase.com (region: Frankfurt, closest to Cairo).
2. Database schema and Edge Functions go live from GitHub: add the repository secrets described in [docs/supabase-deploy.md](docs/supabase-deploy.md) and every merge to `main` applies new files in `supabase/migrations/` and deploys `supabase/functions/admin-users` (workflow **Supabase**). Pull requests that change `supabase/` are checked on a fresh database first. For a brand-new project without the workflow, run the migrations in order in the **SQL Editor**. `0004` adds roles, news, shop and training; `0005` creates the public `media` image bucket; `0006` adds profile photos, admin-only news, product approval and featured products, and match-result assistants; `0007` adds the male/female choice used for the default player avatars; `0008` adds batch player entry and claim codes; `0009` lets the `admin-users` function read and change tables; `0010` stops a claim link from attaching a player to the admin account; `0011` makes batch players admin-only with temporary accounts; `0012` adds role tools, simulations and paid ticks; `0013` adds invitations and bios; `0014` adds the mobile number as username.
2b. Optional demo content: run `supabase/seed/demo_content.sql` to add 24 demo people with photos, 6 articles, 10 products, 3 trainers with slots for the next 10 days, and 3 tournaments (finished, running, open). The pictures ship with the app in `public/demo/`. Demo accounts have no password. `supabase/seed/demo_remove.sql` removes it all. Regenerate with `npx vite-node scripts/demo-seed.ts` (content) and `node scripts/demo-art.cjs` (pictures).
3. The `admin-users` Edge Function is deployed by the same workflow with "Verify JWT" off (the function checks the caller itself; see `supabase/config.toml`).
3b. In **Authentication → URL Configuration**, set the Site URL to where the app is hosted (for example the GitHub Pages URL) so confirmation emails link back to it.
4. Pingo's project URL and publishable key are the defaults in `src/config.ts`. To point at another project, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env.local` (see `.env.example`) or as repository variables `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the GitHub build. `VITE_OFFLINE=1` builds the browser-storage-only version.
5. Sign up in the app, then make yourself admin once in the SQL Editor:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');`

Never put the `service_role` key in the app or the repository.

### Who can do what (enforced in the database by row-level security)

| | Guest | Player | Organizer | Admin |
| --- | --- | --- | --- | --- |
| See published tournaments and approved entrants | ✓ | ✓ | ✓ | ✓ |
| Join / withdraw (while registration is open) | | ✓ | ✓ | ✓ |
| Create tournaments, approve entries, enter scores | | | own tournaments | all |
| Enter match results only (assistant named by the organizer) | | assigned tournaments | | |
| Change roles | | | | ✓ |

At sign-up a person picks player (no approval) or asks to be organizer, trainer or seller (an admin approves). Only an admin grants those roles. A seller's new product, or one whose name, description, photo or category changes, waits for admin approval. Assistants save results through `assistant_save_state`, which refuses any change other than match results.

Roles are additive: one account can be organizer, seller and trainer at once (`profiles.is_organizer / is_seller / is_trainer`; `role = 'admin'` for admins). Players ask for a role from their account page or when signing up; an admin approves it, or grants it directly on the Accounts page or when creating an account.

| | Guest | Signed in | Seller | Trainer | Organizer | Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Read news, browse shop and training slots | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Order products, book training slots | | ✓ | ✓ | ✓ | ✓ | ✓ |
| List products, handle incoming orders | | | ✓ | | | ✓ |
| Add locations and one-hour slots, see trainees | | | | ✓ | | ✓ |
| Write and publish news | | | | | | ✓ |
| Approve products, pick featured products | | | | | | ✓ |

Orders and bookings go through database functions (`place_order`, `set_order_status`, `book_slot`, `cancel_booking`) that check stock, prevent double booking and only let the right person change a status. There is no online payment: buyers pay the seller on delivery, players pay the trainer at the session. `supabase/tests/content_check.sql` exercises these rules.

Players join through the `join_tournament` database function, which checks that registration is open and the tournament is not full. `supabase/tests/` has a manual check of these rules for plain Postgres.

## What the app does

- **Home**: a wide news carousel (each slide opens its article), a tournaments slider (open and running tournaments, plus the champion and runner-up with photos for tournaments that ended in the last 30 days), quick links, featured products and the next free training slots.
- **Admin screen** (`#/admin`): counts, approvals (roles and products), accounts, news publishing, featured products, tournaments, and a **journey simulator** that shows the app as a guest, player, organizer, assistant, trainer or seller (display only; saving still uses the admin's rights).
- **Profile photos** at sign-up or on the account page; **tournament photos and video links** (YouTube plays inline) on a tournament's media tab. Bottom navigation on phones, top navigation on wide screens.
- **News**: blog with categories (news, lessons, tips, events, gear), cover photos, drafts; organizers and admins write.
- **Shop**: products with photos, categories, search, stock; buyers send an order request; sellers get a dashboard with incoming orders (confirm → delivered, or cancel) and their products.
- **Training**: trainer cards, day strip with free one-hour slots, booking with a note; trainers add locations (with a map link) and generate slots by picking weekdays, hours and number of weeks; they see who booked and can cancel.
- **Photos** are shrunk in the browser and stored in Supabase Storage; without a photo each card shows a coloured illustration.

- **Accounts** (online): sign up with email and password, profile with name, phone, birth year and club; "my tournaments" with registration status.
- **Online registration**: the organizer opens registration (optional auto-accept and player limit), shares the link, approves or rejects requests, then closes registration to put approved players into the group draw.
- **Player directory** (organizers): every player saved once, with or without an account; search-as-you-type when building a tournament so nobody is created twice (Arabic hamza/ya/ta-marbuta variants match); link a typed player to an account later.
- **Mobile number as username** (migration `0014`, `admin-users` actions `signup`, `players`, `create`, `set_mobile`, `reset_password`): every player has at least a name and a mobile number. The account signs in with the mobile (hidden email `<mobile>@phone.pingo.example`, no SMS or email sent). Accounts made by an organizer or the admin start with the password `pingo123`; the player is asked to choose a new one at first sign-in (`#/password`) and can change it anytime on `#/me`. Older email accounts still sign in with their email and can switch to their mobile. The admin can edit any account's details and mobile and reset a password back to `pingo123`. `supabase/tests/mobile_login_check.sql` exercises the SQL.
- **Name required** (migration `0023`): every account must have a real name (2+ characters with a letter, never blank or a mobile), checked on every screen that makes or edits an account, in the `admin-users` function, and in the database (`public.is_real_name`, used by `handle_new_user` and checks on `profiles` and `players`). `supabase/tests/name_required_check.sql` exercises the SQL.
- **Batch players** (admin only, `#/players`): import an Excel (.xlsx) or CSV file, or paste "name, mobile" lines. Columns are found by Arabic or English headers (name, mobile, club, gender, birth year) or guessed. Each new mobile gets an account with the password `pingo123`, shared on WhatsApp or printed as cards; optional realistic demo photos for simulations; optional tournament waiting list. Claim codes are no longer made (old codes still work on `#/claim`).
- **Accounts page** (organizers): confirm a sign-up without email in special cases, or create a ready-to-use account for a player (through the `admin-users` Edge Function); admins also change roles.
- After signing up from a tournament page, the player returns to that tournament.
- **No player/organizer switch** (removed). Organizer tools show on a tournament page only for its own organizer and the admin; everyone else sees the player view. Organizers reach their tools from the مساحتي bar and their desk (`#/desk/org`).
- **Help hints** (💡) beside each feature; the **؟** button hides or shows them.
- **Tournament wizard** in 4 steps: name and date, players (one per line, strongest first), number of groups with a live preview, match format per stage and the consolation tournament.
- **Groups board** with drag and drop (mouse and touch), or tap a player then tap a group. Snake seeding spreads the strongest players.
- **Score entry**: per-game inputs with +/− and "11 wins" quick buttons, live validation (11 points, 2-point margin, exactly 2 after 10–10), no extra games after the match is decided, walkovers, and a correction history.
- **Standings** recalculated from results, with the tie-break used shown on each row.
- **Knockout**: top 2 of each group go to the main draw (group winners meet runners-up of other groups), places 3 and 4 go to the consolation draw (default name «بطولة الترضية», editable). Semifinal winners play the final, losers play for third place. Podium and confetti for the champion.
- **Sample data** generator (Arabic and Latin names, valid random scores) at four stages: before start, mid-groups, end of groups, finished.
- **Duplicate tournament**, rename, delete, and **backup download/restore** as JSON.

## Rules implemented

| Rule | Where |
| --- | --- |
| Match win = 1 standings point | `src/domain/standings.ts` |
| Exactly two tied: head-to-head | `resolveTie` |
| Three or more tied: game difference, then points difference, counted in matches among the tied players; if two remain level, head-to-head | `resolveTie` |
| Still tied after that: the organizer orders them manually | `Group.manualOrder`, tie card in the groups tab |
| Format per stage: groups / early rounds / semifinal / final and third place, best of 3 or 5 | `StageFormats`, `roundFormat` |
| Walkover = straight-games win (3–0 in best of 5, 2–0 in best of 3), 11–0 per game | `summarize` |
| Semifinal winners → final (1st, 2nd); losers → third-place playoff (3rd, 4th) | `src/domain/bracket.ts` |
| 1st and 2nd of each group → main draw; 3rd and 4th → consolation draw | `startKnockout` |

## Layout

```
src/domain/   pure logic (no DOM): types, scoring, standings, bracket, tournament, sample data, storage
src/i18n/ar.ts all interface text (Arabic); Western digits via Intl 'ar-EG-u-nu-latn'
src/ui/       styles and small DOM helpers
src/main.ts   screens, routing (#/...), events, drag and drop
tests/        Vitest unit tests
docs/handoff/ the original handoff spec and prototype, kept for reference
```

See `HANDOFF.md` for status, known limits and next steps.
