# Acceptance tests to implement

1. Arabic selected on first visit; entire interface RTL, all controls readable on Android-size viewport.
2. Switch to English; layout becomes LTR and preference survives reload/login as appropriate.
3. Player name typed in Arabic or English is preserved unchanged.
4. Group tie of exactly two players uses head-to-head, regardless of game difference.
5. Group tie of three or more uses game difference then points difference, including mixed tied subsets; final fallback must be explicitly defined.
6. One match win grants exactly one standings point.
7. Semifinal winners enter championship final; semifinal losers enter third-place playoff; places 1–4 derived from these two matches.
8. Scoring game ends at 11+ with two-point margin; configurable match format if supported; prevent extra games after match completed.
9. Duplicate tournament creates independent records, not references to original match results.
10. Role-based data modifications are enforced in Supabase RLS, not merely hidden buttons.
11. Recurring sessions display correctly across locale/timezone boundaries.
12. All critical workflows usable on narrow Android viewport and keyboard accessible.

Current prototype has **not** passed this production acceptance suite.
