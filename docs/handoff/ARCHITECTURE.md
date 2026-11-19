# Suggested free-first production architecture (not yet implemented)

- Frontend: GitHub Pages-compatible static site, modular HTML/CSS/JavaScript (or preserve existing production stack if supplied). Avoid unnecessary frameworks.
- Backend: Supabase Auth + Postgres + RLS; Edge Functions only for privileged server operations where needed.
- Localization: centralized message dictionaries, per-user preferred locale, locale-aware date/number formatting, root document `lang`/`dir`.
- Deploy: GitHub Actions or GitHub Pages; environment configuration without embedding service-role secrets.
- Data: tournaments, registrations, groups, group_members, matches, games, points or point events, players, training_sessions, inventory, sales, user_roles; exact schema to be designed after existing code inspection.
- Security: RLS for every user-facing table, trusted role assignment, no admin/service key in browser, audit log for score corrections and standings publication.
- Testing: deterministic ranking engine tests, scoring tests, role/RLS tests, mobile RTL regression checks.

**No Supabase project credentials or production schema are included in this package.**
