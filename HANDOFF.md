# Pingo handoff (phase 1)

## Status
Phase 1 is a working, tested static web app in Arabic (RTL) with browser storage. It replaces the English-only prototype; the original spec is in `docs/handoff/`.

Decisions confirmed by Omar (2026-11-19):
- Arabic only for now (all text is centralized in `src/i18n/ar.ts` so English can be added later).
- Browser storage first; Supabase later.
- Match format chosen per tournament and per stage (e.g. groups best of 3, final best of 5).
- Unbreakable ties: the organizer decides manually.
- 1st and 2nd of each group qualify; 3rd and 4th play a parallel consolation tournament the admin names (default «بطولة الترضية»).
- Walkovers count as a straight-games win.
- Western digits.
- Interface: game-like, clear, drag and drop where useful, help text beside features, rich visuals, easy switch between player and organizer views, sample data on demand.

Also confirmed:
- In a 3+ way tie, game and points difference are counted only in the matches among the tied players.
- In best of 3, a walkover is recorded as 2-0; each game counts as 11-0 for points difference.

## Assumptions still open
- Knockout seeding: group winners first (group order), then runners-up; first round avoids same-group pairings when possible; byes go to the top seeds when the draw is not a power of two.
- Consolation draw uses the same per-stage formats as the main draw.

## Phase 2 (Supabase), 2026-11-19
- Omar's scope: Supabase for authentication and saving everything; GitHub for versioning and Actions; Edge Functions only when needed (none needed yet).
- Tables: `profiles`, `tournaments` (full app state in `state` jsonb plus indexed columns), `registrations`. RLS on all three; joins go through `join_tournament()`.
- Per tournament the organizer chooses approval vs auto-accept and an optional player limit (Omar's answer still pending; both supported).
- Without Supabase settings the app still runs offline with browser storage.

## Player directory and organizer-managed accounts, 2026-11-19
- `players` table = shared directory (typed players need no email). `player_for_profile()` makes a row for an account on first use; `link_player()` links a typed player to an account (an existing account row is marked `merged_into`).
- Edge Function `admin-users` (service-role key stays in Supabase): list unconfirmed sign-ups, confirm manually, create a confirmed account. Callable by organizers and admins only.
- Email confirmation stays on for normal sign-ups (Omar's choice: organizers can bypass it in special cases).

## Known limits
- Offline mode: data lives in one browser (backup download/restore to move it).
- Online mode: two organizers editing the same tournament at the same moment overwrite each other (last save wins). No live updates yet; pages refresh on navigation.
- A knockout result can be corrected only while the next match has no result (correct later matches first).
- No player profiles across tournaments, training schedules or shop yet.

## Suggested next steps
1. Live updates (Supabase Realtime) for scores, and per-match scorekeeper accounts.
2. Player directory and profiles with history across tournaments.
3. Training schedules, then the shop.
4. English dictionary and switcher if wanted.

## Score entry, 2026-11-20
- Default (Omar's choice): the organizer or assistant enters only the match result in games with one tap (3-0, 3-1, 3-2 / 2-0, 2-1), stored in `Match.result`.
- Points of every game is an optional per-tournament setting (`Tournament.pointsPerGame`, in the wizard and the tournament settings). Entry: tap the game winner, type the loser's points; the winner's points are filled in (11, or +2 after 10-10).
- Older tournaments without the setting keep detailed scoring if they already have game points (`recordsPoints`).
- Tie-breaks: points difference is used only when every match among the tied players has game points; otherwise players still level on games go to the organizer.

## Role tools ("مكتب بينجو"), 2026-11-21
- Back office apart from the public site at `#/desk/org`, `#/desk/trainer`, `#/desk/seller`, `#/desk/admin` (own header and role tabs; "عرض الموقع" goes back). Code in `src/admin/` (one file per role), text in `src/i18n/ar-desk.ts`. The مساحتي bar and `#/org` now lead here.
- Organizer: create a tournament (opens registration), simulate demo players joining (random count or picked by photo), approve, close and draw groups, play rounds, knockout, champion. Entry fee per tournament (`fee`) and who paid (`paid`) live in the tournament state (`src/domain/payments.ts`).
- Trainer: week strip, add a demo week of slots, simulate bookings, paid tick per booking, totals. Seller: demo products, simulate orders, status buttons, paid tick per order, totals.
- Database: migration 0012 (bookings.paid, orders.paid, set_*_paid, sim_players/sim_join/sim_book/sim_order/sim_clear). 40 demo accounts `sim01..sim40@demo.pingo.example` with CC0 AI portraits in `public/demo/players` (seed `supabase/seed/sim_players.sql`; removed by `demo_remove.sql`).

## Tournament invitations and biographies, 2026-11-21
- Organizer (own tournaments) or admin (any tournament) invites registered users from the desk control room, step 1 ("دعوة لاعبين"): search by name, pick several, send. Statuses: pending, accepted, declined, cancelled (organizer can take back a pending one).
- The invited player sees a gold card on the home page, on #/me and on the tournament's registration tab, with accept/decline. Accepting enters the player as approved straight away (no second approval), within the player limit, while registration is open.
- Simulation in the same card: invite N demo players, then "make them answer" (about 4 in 5 accept).
- Database: migration 0013 (`invitations` table, `invite_players`, `cancel_invitation`, `answer_invitation`, `sim_answer_invitations`; `public_profiles.is_organizer`). Code: `src/pages/invites.ts`.
- Biography (optional, `profiles.bio`, 600 chars): organizers, trainers and sellers edit it in a card at the top of their desk (or on #/me). Shown on the new public page `#/u/<id>` (linked from the organizer name on tournament pages and the seller box on products), on the trainer page and on product pages.
- The tournament-page simulation ("محاكاة البطولة") now uses the 40 registered demo players first, so simulated players show real-looking photos.

## Sports shops with Pingo promotions, 2026-11-22
- A seller opens one shop page (`#/shops/edit`, also from the seller desk card «متجري الرياضي»): name, tagline, logo, cover, city, address, map link, hours, phone, WhatsApp, about, and a promotion for Pingo players (title, details, discount %, code, end date). «املأ ببيانات تجريبية» fills a demo shop.
- Section `#/shops` (tab beside the products list in المتجر): search, city chips, "with offers only". Shop page `#/shops/<seller id>`: WhatsApp/call/map buttons, promotion card, the shop's approved products. Home page strip «متاجر بعروض للاعبي بينجو».
- Promotion: the discount % is applied by the database to every new order of that seller (trigger on orders, `orders.promo_pct`), and product cards show the struck price and the Pingo price to signed-in players. The code and the "Pingo pass" (player photo + name + code) show only to signed-in players; visitors cannot read `shops.promo_code`.
- Products keep the admin approval. The admin can hide or feature a shop from its page.
- Database: migration 0018_sports_shops.sql (`shops` table, `shop_discount()`, `apply_shop_discount` trigger). Code: `src/pages/shops.ts`, text `src/i18n/ar-shops.ts`.

## Player blacklists and favourites, 2026-11-22
- Organizer's blacklist (#/desk/org/players, button «لاعبيني» on the organizer desk, or 🚫 beside a pending request): the player cannot join, be invited to or be added to that organizer's tournaments; other organizers' tournaments are not affected. Optional private reason. Taking a player off the list is one tap.
- Admin's site-wide blacklist (#/desk/admin/blacklist, tile on the admin desk): the player cannot join any tournament. Organizers see these players marked and cannot pick them.
- Blacklisting rejects the player's pending/approved entries in the owner's tournaments that are still in draft or open registration (all tournaments for the admin list) and cancels pending invitations. Started tournaments are untouched. After unblocking, the old entry stays "rejected"; the organizer can add the player again.
- Enforced in the database (migration 0016): trigger on `registrations` raises `player blocked` for any path to pending/approved; trigger on `invitations` skips blocked players; `waitlist_add` and `sim_join` skip them. Players get only `my_blocks()` (whose tournaments), never reasons.
- Favourites (⭐ on the same page, plus "players from your tournaments" suggestions). In a tournament's invitation card the favourites appear as photos: pick all in one tap, then "invite" or "add directly" (`org_add_players`: approved straight away, within the player limit).
- Not enforced: players typed by hand into a tournament's own player list (names without accounts) are not checked.

## Notifications, 2026-11-22
- Omar's scope: in-app bell + phone push for the alerts below, one-tap WhatsApp messages for organizers, per-type on/off. No "your next match" calls and no email reminders.
- Alerts are made by database triggers (migration 0020), so every path (site, desk, simulations) alerts the same way: invites, join approved/rejected/added, draw out / match result / tournament finished, payment sent/approved/rejected, hall and training bookings, orders, product awaiting/approved, role requests and decisions, subscriptions ending within 7 days, new promotion of a followed shop (⭐ on the shop page), join requests/withdrawals/declined invites and "nearly full / full" for organizers. Repeats fold into one unread row with a count. Demo (sim) players never get alerts.
- Bell in both headers (site and desk), `#/alerts` (list) and `#/alerts/settings` (phone push on/off for this device, and each type on/off in the app and on the phone). Card on #/me, one nudge card on the home page.
- Phone push: Edge Function `send-push` (deployed by the Supabase workflow, `verify_jwt = false`). It makes its VAPID keys itself on first use and stores them in `push_config` (service role only), so there are no secrets to set. The database calls it through pg_net with a secret from the same table. iPhone needs Pingo installed on the home screen (iOS 16.4+).
- Subscription reminders: pg_cron job `pingo-daily-alerts` at 07:00 UTC when pg_cron is available; the bell also runs it at most every 3 hours.
- WhatsApp: card «رسائل واتساب جاهزة» on the organizer's tournament page in the desk: templates, editable text, send to a group (wa.me without number) or to each player (`tournament_contacts()`), filter unpaid/pending.
- Check: `supabase/tests/notifications_check.sql`.

## Group editing on phones, 2026-11-22
- Setup board (#/t/<id>/groups): on phones two groups per row, each player a small tile with the photo above the name.
- Summary bar above the groups (sticky): places in groups (a player who also fills another group counts twice), how many are different players, waiting list count, a pill per group (short groups in orange).
- Tap a player: bottom sheet to move to another group (drop-down), also fill another group while staying in their own, back to the waiting list, or delete from the tournament (two taps). Drag and drop still works.
- «نشر المجموعات»: `Tournament.groupsPublished`. During setup players see a "groups being prepared" card instead of the draw until the organizer (or admin) publishes; once groups start they are always visible. Hiding is in the app only (the state JSON is still readable).
- Quick add card: name + mobile puts a new player straight on the waiting list (online: temporary account through admin-users 'players', password pingo123). No SQL.
