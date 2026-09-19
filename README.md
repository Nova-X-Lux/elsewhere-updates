# Elsewhere

A small phone-friendly update reader. Each source is fetched on a schedule; follows, keywords, read history and durable saved articles are kept on the reader's device. No AI service, paid API, accounts, database or browser-to-feed proxy is required.

## Run locally

Requires Node 22+ and Python 3.11+. There are **no package dependencies** to install.

```sh
npm run collect
npm run build
npm run dev
```

Open the printed URL. The local server also accepts `/elsewhere/` to exercise GitHub Pages project paths. `node scripts/serve.mjs --dist` serves the built site.

## Check

```sh
npm run check
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run build
```

## GitHub Pages

Use this repository as its own **public** GitHub repository, with `main` as its default branch. Set Settings → Pages → Build and deployment → Source to **GitHub Actions**. The committed workflow builds and publishes on pushes, manual runs, and roughly every four hours at minute 17. The project works at `/elsewhere/` or any other repository subpath because all app URLs are relative.

The workflow uses standard public Ubuntu runners, a small Pages artifact retained for one day, and public source feeds. No paid runners, paid APIs, secret configuration or purchases are involved. Standard public Actions usage and public Pages hosting are free under GitHub's current rules. Keep the repository public to preserve this setup. Do not enable paid capacity or third-party services.

- [GitHub Pages availability and custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Scheduled runs can be delayed or dropped, and GitHub can disable schedules after 60 days of repository inactivity. Check Actions if the timestamp becomes stale; re-enable the workflow or use Run workflow. Refresh in the app reloads the latest published collection, and cannot start a server-side collection. The workflow retains collection history by committing the generated JSON using GitHub's built-in job token. Those automated commits do not start another push workflow. A failed collection does not replace the previous successful snapshot.

## Reader controls

- Explore: search 22 available topics, including 11 Pokémon choices. Search matches names, aliases and publishers, with or without accents. Follow/unfollow directly from pictured topic cards.
- My follows: optionally filter an individual source by comma-separated words/phrases. A match on any phrase keeps the article. These filters operate on titles and short previews, not full article bodies.
- My feed: search, filter by source/unread, mark read, hide, and save an update. Opening the original marks it read.
- Catch-up: group the past 24 hours or seven days by source. Undated entries use their original first-seen date and are labelled Added.
- Saved: saved titles, original links and short previews are kept locally even after a source's collection rotates.
- Settings: export/restore a JSON backup to move follows, keywords, read history and saved posts between devices. Restore explicitly asks before replacing the current list.

There is no automatic account sync, email, Discord or push notification delivery in this version. Daily/weekly catch-up is on the website. Local preferences stay in browser storage; clearing that storage removes them unless a backup was kept. No analytics or third-party font requests are included.

## Pokémon and pictures

Pokémon news, games, physical cards, TCG Pocket, GO, anime, merchandise, Play! Pokémon events, UNITE, Sleep and Masters EX are separate follows. GO uses its official server-rendered news listing; PokéJungle and Pokémon Blog are clearly labelled independent fan sites. Nintendo, Animal Crossing and Zelda use Nintendo Life. Merchandise availability varies by country.

Article thumbnails are extracted from source Media RSS, image enclosures, HTML or Steam BBcode. Images load directly from publishers; this sends those hosts an image request. Failed images are removed cleanly. Topic art is credited in the app. No full articles or images are copied into the repository. Read, hide and save actions apply across duplicate article URLs when several followed topics overlap.

## Add or change sources

Edit `sources.json` and add an official RSS/Atom feed or a Steam community announcement feed. Keep stable unique IDs and supply `name`, `category`, `website`, `url`, `type` (`rss`, `atom`, `steam`, or the official listing adapter `pokemon-go`), `description`, `color`, and `initials`. Optional fields: `aliases` (array), `publisher`, `publisherType`, `official`, `imageUrl` (public HTTPS) and `imagePage` (credit page). Keep source pictures and credits paired. Run the collector and checks before pushing. Source configuration and collected articles are public; never put private URLs, account tokens, credentials or Katie's personal information in the repository.

The library is intentionally explicit. Following a topic cannot search the entire internet. New artists, authors or other interests require a suitable feed in the catalogue. The catalogue can grow when more working public feeds are available.

Sources are linked and attributed; summaries are short feed excerpts of at most 220 characters, never generated claims. HTML is removed in collection and escaped in rendering. Full publisher articles and external images are not republished. Recheck source availability and terms when changing the catalogue.

Project Gutenberg entries may be new or updated ebooks and have no source publication dates. itch.io's feed is a new-and-popular discovery list rather than a developer-news feed. The Steam adapter accepts publisher community announcements only.

The collector validates public feed/redirect URLs, bounds response size and request time, deduplicates within each source, preserves first-seen times, and keeps a failed source's previous articles with a visible status. This is a trusted committed catalogue, not an arbitrary URL proxy.
