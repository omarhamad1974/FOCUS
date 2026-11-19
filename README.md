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
2. In **SQL Editor**, paste `supabase/migrations/0001_init.sql` and click **Run**.
3. In **Authentication → URL Configuration**, set the Site URL to where the app is hosted (for example the GitHub Pages URL) so confirmation emails link back to it.
4. Copy **Project URL** and the **anon public** key from **Project Settings → API**:
   - locally: put them in `.env.local` (see `.env.example`);
   - on GitHub: add them as repository **variables** `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables).
5. Sign up in the app, then make yourself admin once in the SQL Editor:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');`

Never put the `service_role` key in the app or the repository.

### Who can do what (enforced in the database by row-level security)

| | Guest | Player | Organizer | Admin |
| --- | --- | --- | --- | --- |
| See published tournaments and approved entrants | ✓ | ✓ | ✓ | ✓ |
| Join / withdraw (while registration is open) | | ✓ | ✓ | ✓ |
| Create tournaments, approve entries, enter scores | | | own tournaments | all |
| Change roles | | | | ✓ |

Players join through the `join_tournament` database function, which checks that registration is open and the tournament is not full. `supabase/tests/` has a manual check of these rules for plain Postgres.

## What the app does

- **Accounts** (online): sign up with email and password, profile with name, phone, birth year and club; "my tournaments" with registration status.
- **Online registration**: the organizer opens registration (optional auto-accept and player limit), shares the link, approves or rejects requests, then closes registration to put approved players into the group draw.
- **Admin page** to make users organizers or admins.
- **Organizer / player switch** in the header (shown to organizers). Player view is read-only.
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
