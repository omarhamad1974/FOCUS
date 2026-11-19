# Pingo — development handoff

## Project goal
Create an attractive, mobile-first table tennis tournament and training platform with Arabic (default) and English, supporting players, tournament organizers, trainers, sellers and administrators. Free-first hosting: GitHub (static frontend) and Supabase (auth/database/server-side permissions). Avoid paid infrastructure unless needed.

## Current artifact status (verified)
- `prototype/index.html`: standalone interactive frontend demo, browser runnable, not production ready.
- `locales/ar.json`, `locales/en.json`: initial UI message dictionaries.
- No complete Phase 6 production source was accessible. Prior phase names describe planned/previously discussed functionality, **not evidence of deployed code**.

## Preserve these settled rules
1. Group standings: match win = 1 standings point.
2. For **exactly two** players tied on standings points, rank by head-to-head result.
3. For **three or more** tied players, use game difference, then points difference. Define/document a deterministic final fallback if still tied and get user confirmation before treating fallback as official.
4. Knockout semifinals: winners play championship final for places 1 and 2; losers play a separate 3rd-place playoff for places 3 and 4.
5. Group third-place finish is determined by group ranking rules, not by a knockout placement match.

## Agreed feature scope
- Tournament creation wizard, duplication, configurable groups and bracket.
- Visual drag/drop or mobile-friendly alternative group and bracket editor.
- Fast match point/game scoring, result verification and score correction/audit trail.
- Player directory, profiles, match history and statistics.
- Recurring trainer schedules.
- Role-based interfaces: Admin, Organizer, Trainer, Seller, Player.
- Equipment/shop module represented in prototype; production inventory/sales needs definition.
- Fully responsive, table-tennis-themed design; mobile use is a priority.
- Arabic default; English switcher; full RTL/LTR including tables, bracket, forms, dashboards; persistent preference; Arabic-friendly fonts; names shown exactly as entered.

## Recommended implementation order
1. Inspect actual existing production repository if provided. Inventory routes, schemas, migrations, permissions, and tests; run build before edits.
2. Extract shared UI patterns and introduce localization architecture with `lang` and `dir` at document root. Translate **all** production modules, not only the demo.
3. Model tournament/matches/players, implement standings engine with unit tests for ties and placement.
4. Implement Supabase auth and server-enforced row-level security (RLS), not client-side-only roles.
5. Add tournament wizard/duplicate, editor, scoring, history, recurring schedules.
6. Test mobile Arabic and English, edge cases, authorization, and GitHub deployment.
7. Deliver one **cumulative** ZIP each phase: complete working source, README, HANDOFF, migrations, setup steps, test results and known issues.

## Important questions to resolve during production work
- Are matches best-of-3, best-of-5, or configurable by round?
- How many players qualify from each group, and how are cross-group seeds paired?
- What should happen when 3+ tied players remain tied after both differentials?
- How should abandoned, walkover, or unplayed matches count?
- Which roles may approve/edit results and see financial records?

Avoid inventing these as settled rules. Keep configurable defaults or request a decision.
