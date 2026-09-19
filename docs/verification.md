# Verification — 19 September 2026

- 7 JavaScript tests passed: follow/keyword filtering, safe URLs/HTML escaping, saved/read states, date windows, undated items, durable saved snapshots, backup validation and source-aware deduplication.
- 21 Python collector tests passed: RSS/Atom/Steam parsing, source URL/redirect checks, markup stripping, duplicate IDs, first-seen preservation, source failure retention, all-source failure behaviour and weekly history beyond 40 posts.
- Live collection: 8 sources succeeded, 146 unique source items. Dates and text came from actual source feeds. No sample headlines shipped.
- Static build and JavaScript syntax checks passed. Relative assets and JSON loaded at `/elsewhere/` locally.
- Browser interactions verified in Codex's browser: follow, library search, saved/read toggle, unread filtering, reload persistence, daily and weekly catch-up, Gutenberg's undated entries, empty search state, per-source keywords, backup restoration confirmation, and saved article access after unfollowing.
- Responsive layouts inspected at 1365px, 390px and 320px; no horizontal overflow in DOM measurements. These are viewport checks, not physical phone testing.
- Browser error/warning log was empty during checked flows.
- Export button triggered its handler; the browser automation did not emit its expected download event in either the in-app browser or Chrome. Restore was verified using a valid local backup fixture. Download delivery has not been independently confirmed; do not claim it passed.
- The preview used isolated local browser preferences, without touching Katie's Pixel Friend or its database.

## Live deployment

- Published at https://nova-x-lux.github.io/elsewhere-updates/ from its own public repository.
- GitHub Actions run 35413170269 completed successfully: collection, tests, build, retained snapshot and Pages deployment.
- Live JSON loaded successfully with 8 successful sources, 146 items, and generatedAt 2026-09-19T01:36:31Z.
- On the actual Pages URL, first-use onboarding, following PlayStation Blog, saving a real update, and saved-item persistence after a reload passed. The live browser error/warning log was empty.
- The first token lacked the scope to create workflow files. The already connected GitHub app added the workflow successfully; no account permissions or token scopes were expanded.

- Final deployment run 35413290873 succeeded. Live HTML, application script, model, CSS and favicon matched the local build byte-for-byte.
- A returning browser retained the old unversioned JavaScript. The build now fingerprints application, model and stylesheet filenames so new releases invalidate browser caches.
