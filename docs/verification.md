# Verification — 19 September 2026

- 7 JavaScript tests passed: follow/keyword filtering, safe URLs/HTML escaping, saved/read states, date windows, undated items, durable saved snapshots, backup validation and source-aware deduplication.
- 21 Python collector tests passed: RSS/Atom/Steam parsing, source URL/redirect checks, markup stripping, duplicate IDs, first-seen preservation, source failure retention, all-source failure behaviour and weekly history beyond 40 posts.
- Live collection: 8 sources succeeded, 146 unique source items. Dates and text came from actual source feeds. No sample headlines shipped.
- Static build and JavaScript syntax checks passed. Relative assets and JSON loaded at `/elsewhere/` locally.
- Browser interactions verified in Codex's browser: follow, library search, saved/read toggle, unread filtering, reload persistence, daily and weekly catch-up, Gutenberg's undated entries, empty search state, per-source keywords, backup restoration confirmation, and saved article access after unfollowing.
- Responsive layouts inspected at 1365px, 390px and 320px; no horizontal overflow in DOM measurements. These are viewport checks, not physical phone testing.
- Browser error/warning log was empty during checked flows.
- Export button triggered its handler; the in-app browser did not emit its expected download event. Restore was verified using a valid local backup fixture. Browser-specific download delivery has not been independently confirmed.
- The preview used isolated local browser preferences, without touching Katie's Pixel Friend or its database.

Deployment and live verification are recorded below after the GitHub Actions run completes.
