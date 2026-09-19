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


## Pink redesign - 19 September 2026

- Replaced the blue sidebar layout with a pink noticeboard, notebook navigation and pictured topic catalogue. No additional runtime dependencies or paid services.
- Live source probe succeeded for 22/22 sources, including 11 distinct Pokémon choices. Snapshot: 326 stories, 258 carrying image metadata. Existing story IDs and first-seen times were preserved.
- 11 model tests and 29 collector tests pass. Coverage includes accent/alias/multiple-word discovery search, source filters, literal keywords, image extraction and safe URLs, saved-image backup round trips, duplicate URL read/hide behaviour, source failure retention, and official Pokémon GO listing parsing. Syntax, build and diff whitespace checks pass.
- Local browser: followed Pokémon cards and GO from discovery, searched feed stories, saved a pictured card article, opened Saved, reloaded and verified that story and picture persisted. Test follows and bookmark were removed again; pre-existing local follows/saved content were preserved.
- Discovery: unaccented `cards pokemon` finds physical cards and Pocket; `plushies` finds merchandise; no-match reset returns 22 choices. No horizontal overflow at 1280, 390 and 320 CSS pixels. These are browser viewport checks, not tests on a physical phone.
- Official Pokopia hero and the first six topic covers visibly loaded in the browser. Some publishers block their article images; a failed thumbnail is removed and a topic falls back to its initials.
- Backup download limitations from the original verification remain unchanged; no download-history workaround was attempted in this redesign.
