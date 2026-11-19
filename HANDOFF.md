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

## Assumptions to confirm
- In a 3+ way tie, game and points difference are counted only in the matches among the tied players (ITTF style), not the whole group.
- In best of 3, a walkover is recorded as 2–0 (3–0 is impossible); each game counts as 11–0 for points difference.
- Knockout seeding: group winners first (group order), then runners-up; first round avoids same-group pairings when possible; byes go to the top seeds when the draw is not a power of two.
- Consolation draw uses the same per-stage formats as the main draw.

## Known limits
- Data lives in one browser. Use backup download/restore to move it.
- Player/organizer switch is not security; anyone can switch. Real roles need Supabase auth and RLS.
- A knockout result can be corrected only while the next match has no result (correct later matches first).
- No player profiles across tournaments, training schedules or shop yet.

## Suggested next steps
1. Supabase: auth, tables, RLS per role, move storage behind the same domain functions.
2. Player directory and profiles with history across tournaments.
3. Training schedules, then the shop.
4. English dictionary and switcher if wanted.
