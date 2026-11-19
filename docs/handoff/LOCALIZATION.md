# Arabic/English localization — mandatory for production

Arabic (`ar`) is the default; English (`en`) is selectable. Persist preference for signed-in users (and optionally localStorage for guests). Switch `document.documentElement.lang` and `dir` (`rtl` for Arabic, `ltr` for English). Translate every label, status, validation error, notification, empty state, dashboard, match result, table heading and admin setting.

Use CSS logical properties (`margin-inline-start`, `padding-inline-end`, etc.) and direction-aware iconography. Verify scoreboards and brackets in RTL explicitly: do not blindly reverse numeric scores or the logical winner/loser relationships. Use `Intl.DateTimeFormat` and `Intl.NumberFormat` for display; keep stored dates/numbers locale-neutral. Preserve player names as entered. Offer bilingual tournament/service text fields when appropriate.

Suggested font: Cairo or Tajawal with appropriate licensing/loading. Provide an accessible language switcher on mobile and desktop. All translation keys should be maintained in both locales, with tests for missing keys. The starter JSON dictionaries are partial and must be expanded.
