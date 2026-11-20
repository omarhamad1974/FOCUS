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
