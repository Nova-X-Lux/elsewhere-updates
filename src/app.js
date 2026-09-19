import {
  STORAGE_KEY,
  defaultState,
  validateState,
  safeUrl,
  escapeHtml as esc,
  selectedItems,
  searchSources,
  relatedItemIds,
  isItemMarked,
} from "./model.js";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
let data,
  state,
  view = "latest",
  query = "",
  exploreQuery = "",
  exploreCategory = "All",
  sourceFilter = "all",
  unread = false,
  pageSize = 30,
  busy = false,
  storageWarning = "",
  sessionVisit = null,
  lastFocus,
  toastTimer;
const icons = {
  explore: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  heart:
    '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 8 15 8 15S25 10 20 5Z"/>',
  latest: '<path d="M4 5h16v14H4zM4 9h16M8 13h3m-3 3h8"/>',
  digest: '<path d="M7 3h10v4H7zM5 5H3v16h18V5h-2M7 12h10m-10 4h7"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  following:
    '<circle cx="9" cy="8" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M19 7v6m-3-3h6"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  external: '<path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name, extra = "") =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.latest}</svg>`;
const sourceOf = (id) => data.sources.find((s) => s.id === id);
const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year:
          new Date(value).getFullYear() !== new Date().getFullYear()
            ? "numeric"
            : undefined,
      }).format(new Date(value))
    : "";
const exactDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not yet checked";
function ago(value) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return m < 2
    ? "just now"
    : m < 60
      ? `${m} minutes ago`
      : m < 1440
        ? `${Math.floor(m / 60)} hours ago`
        : `on ${dateLabel(value)}`;
}
function announce(text) {
  document.querySelector("#announcer").textContent = text;
}
function toast(text) {
  const el = document.querySelector("#toast");
  clearTimeout(toastTimer);
  el.textContent = text;
  el.classList.add("visible");
  toastTimer = setTimeout(() => el.classList.remove("visible"), 4000);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    storageWarning =
      "This browser could not save your changes. Download a backup in Settings before you close the page.";
    toast(storageWarning);
  }
}
function filtered() {
  return selectedItems(data.items, state, {
    view,
    source: sourceFilter,
    query,
    unread,
  });
}
function sourceBadge(s, extra = "") {
  return `<span class="source-badge ${extra}" aria-hidden="true">${esc(s.initials || s.name.slice(0, 2))}</span>`;
}
function photo(url, className = "", alt = "") {
  const safe = safeUrl(url);
  return safe
    ? `<img class="${className}" src="${esc(safe)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : "";
}
function sourcePhoto(source) {
  return (
    source.imageUrl ||
    data.items.find(
      (item) => item.sourceId === source.id && safeUrl(item.imageUrl),
    )?.imageUrl ||
    ""
  );
}
function navigation() {
  return [
    ["explore", "Explore", null],
    [
      "latest",
      "My feed",
      selectedItems(data.items, state, { unread: true }).length,
    ],
    ["digest", "Catch-up", null],
    [
      "saved",
      "Saved",
      selectedItems(data.items, state, { view: "saved" }).length,
    ],
    ["following", "My follows", state.following.length],
  ]
    .map(
      ([id, label, count]) =>
        `<button class="nav-button ${view === id ? "active" : ""}" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ""}</button>`,
    )
    .join("");
}
function render() {
  const headings = {
    explore: "What are you into?",
    latest: "Your updates",
    digest: "A little catch-up",
    saved: "Keepers",
    following: "Things you follow",
    settings: "Settings",
  };
  const descriptions = {
    explore: "Find something you like and follow along.",
    latest: state.following.length
      ? `The latest from the ${state.following.length === 1 ? "thing" : `${state.following.length} things`} you follow.`
      : "Choose a few things to start your reading list.",
    digest: "A few minutes with the things you like.",
    saved: "Good things to come back to.",
    following: "Add, remove or fine-tune what turns up in your feed.",
    settings: "A few settings for your reading list.",
  };
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  app.innerHTML = `<div class="layout"><header class="masthead"><a class="wordmark" href="#" data-action="home" aria-label="Elsewhere home">elsewhere${icon("heart")}</a><span class="masthead-note">Katie’s noticeboard</span><button class="find-link" data-action="browse" aria-label="Find something to follow">${icon("search")}<span>Find something to follow</span></button><button class="icon-button settings-link ${view === "settings" ? "active" : ""}" data-action="view" data-view="settings" aria-label="Settings">${icon("settings")}</button></header><div class="notebook"><nav class="primary-nav" aria-label="Main navigation">${navigation()}</nav><div class="content"><div class="topbar"><span class="today">${today}</span><button class="text-button refresh" data-action="refresh" ${busy ? "disabled" : ""}>${icon("refresh", busy ? "spinning" : "")}<span>${busy ? "Checking…" : "Refresh"}</span></button></div><main id="main" tabindex="-1">${storageWarning ? `<div class="notice warning">${esc(storageWarning)}</div>` : ""}${Date.now() - Date.parse(data.generatedAt) > 86400000 ? `<div class="notice warning">These updates were last checked ${ago(data.generatedAt)}. The next collection may be delayed.</div>` : ""}<div class="page-heading"><div><h1>${headings[view]}</h1><p>${descriptions[view]}</p></div>${view === "latest" || view === "following" ? `<button class="secondary-button" data-action="browse">${icon("plus")}Find more</button>` : ""}</div>${view === "explore" ? exploreView() : view === "following" ? followingView() : view === "settings" ? settingsView() : readingView()}</main><footer class="page-footer"><span>Last collected ${ago(data.generatedAt)}</span><button data-action="about">About & picture credits</button></footer></div></div></div>`;
}
function followButton(s) {
  const following = state.following.includes(s.id);
  return `<button class="follow-button ${following ? "is-following" : ""}" data-action="follow" data-id="${esc(s.id)}" aria-pressed="${following}" aria-label="${following ? "Unfollow" : "Follow"} ${esc(s.name)}">${icon(following ? "check" : "plus")}<span>${following ? "Following" : "Follow"}</span></button>`;
}
function exploreView() {
  const pokemon = data.sources.find((s) => s.id === "pokemon-games");
  return `<div class="discovery-search"><label class="search-field"><span class="search-icon">${icon("search")}</span><input id="explore-search" type="search" placeholder="Pokémon, cards, cosy games…" aria-label="Search things to follow" value="${esc(exploreQuery)}" autocomplete="off" /><span class="search-hint">Find your favourites</span></label></div><div class="suggestions"><span>Try</span>${["Pokémon", "Cards", "Cozy games", "Nintendo", "Anime"].map((term) => `<button data-action="suggestion" data-query="${esc(term)}">${esc(term)}</button>`).join("")}</div>${pokemon ? `<section class="pokemon-shelf" ${exploreQuery || exploreCategory !== "All" ? "hidden" : ""}><div class="shelf-copy"><span class="paper-label">For your collection</span><h2>The Pokémon corner</h2><p>Games to play, cards to collect,<br />and everything in between.</p><button class="primary-button" data-action="suggestion" data-query="Pokémon">Have a look ${icon("plus")}</button></div><div class="shelf-photo">${photo(sourcePhoto(pokemon), "", "Pokémon game artwork")}<span class="photo-caption">A whole world to keep up with ♡</span></div></section>` : ""}<section class="discover-section" aria-label="Things to follow"><div class="category-tabs" role="group" aria-label="Interest category">${["All", ...new Set(data.sources.map((s) => s.category))].map((c) => `<button data-action="explore-category" data-category="${esc(c)}" aria-pressed="${exploreCategory === c}">${esc(c === "All" ? "Everything" : c)}</button>`).join("")}</div><div id="explore-results">${exploreResults()}</div></section><p class="local-note">Your follows stay on this device. No account needed.</p>`;
}
function exploreResults() {
  const sources = searchSources(data.sources, exploreQuery, exploreCategory);
  return `<div class="catalog-heading"><h2>${exploreQuery ? `Found for “${esc(exploreQuery)}”` : exploreCategory === "All" ? "Pick a few favourites" : esc(exploreCategory)}</h2><span>${sources.length} ${sources.length === 1 ? "choice" : "choices"}</span></div>${sources.length ? `<div class="topic-grid">${sources.map((s) => `<article class="topic-card"><div class="topic-photo">${sourceBadge(s, "photo-fallback")}${photo(sourcePhoto(s))}<span class="topic-category">${esc(s.category)}</span></div><div class="topic-copy"><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="topic-bottom"><a class="source-credit" href="${esc(safeUrl(s.website))}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${esc(s.name)} source">${esc(new URL(s.website).hostname.replace(/^www\./, ""))}${icon("external")}</a>${followButton(s)}</div>${s.error ? '<span class="source-unavailable">Last available updates · source check delayed</span>' : ""}</div></article>`).join("")}</div>` : `<div class="library-empty"><h3>That one isn’t on the shelf yet.</h3><p>Try a different name or a wider interest. Search covers the sources available here.</p><button class="secondary-button" data-action="reset-explore">Show everything</button></div>`}`;
}
function updateExplore() {
  const results = document.querySelector("#explore-results");
  if (results) results.innerHTML = exploreResults();
  document
    .querySelectorAll('[data-action="explore-category"]')
    .forEach((el) =>
      el.setAttribute(
        "aria-pressed",
        String(el.dataset.category === exploreCategory),
      ),
    );
  const shelf = document.querySelector(".pokemon-shelf");
  if (shelf) shelf.hidden = Boolean(exploreQuery || exploreCategory !== "All");
  announce(
    `${searchSources(data.sources, exploreQuery, exploreCategory).length} things to follow`,
  );
}
function readingView() {
  if (!state.following.length && view !== "saved") return welcomeView();
  const failed = data.sources.filter(
    (s) => s.error && state.following.includes(s.id),
  );
  return `${view !== "saved" && failed.length ? `<div class="notice warning source-warning">Couldn’t reach ${failed.map((s) => esc(s.name)).join(", ")}. Showing the last available updates. Check Following for the last successful check.</div>` : ""}${view === "digest" ? `<div class="digest-controls"><div class="segmented" role="group" aria-label="Catch-up period"><button data-action="period" data-period="day" aria-pressed="${state.digest === "day"}">Past 24 hours</button><button data-action="period" data-period="week" aria-pressed="${state.digest === "week"}">Past 7 days</button></div><span>Grouped by source</span></div>` : ""}<div class="reading-tools"><label class="search-field">${icon("search")}<input type="search" id="search" placeholder="Search your updates" value="${esc(query)}" aria-label="Search your updates" autocomplete="off" /></label><label class="sr-only" for="source-filter">Filter by source</label><select id="source-filter"><option value="all">All sources</option>${(view === "saved" ? data.sources.filter((s) => [...data.items, ...Object.values(state.savedItems || {})].some((i) => i.sourceId === s.id && state.saved.includes(i.id))) : data.sources.filter((s) => state.following.includes(s.id))).map((s) => `<option value="${esc(s.id)}" ${sourceFilter === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><button class="unread-toggle" data-action="unread" aria-pressed="${unread}"><span class="toggle-dot"></span>Unread</button></div><div id="results">${resultsView()}</div>`;
}
function resultsView() {
  const list = filtered();
  if (!list.length) {
    const hasFilters = query || sourceFilter !== "all" || unread;
    return `<div class="empty-state"><span class="empty-icon">${icon(view === "saved" ? "saved" : "check")}</span><h2>${hasFilters ? "Nothing matches just yet." : view === "saved" ? "Keep something for later." : view === "digest" ? "A quiet few days." : "Nothing new on your list."}</h2><p>${hasFilters ? "Try another search, or clear your filters." : view === "saved" ? "Use the bookmark beside an update. You’ll find it here when you’re ready." : view === "digest" ? "There are no updates in this period. Older posts are still in Latest." : "You can add another source or adjust your keywords in Following."}</p>${hasFilters ? '<button class="secondary-button" data-action="clear-filters">Clear filters</button>' : `<button class="secondary-button" data-action="${view === "digest" || view === "saved" ? "latest" : "browse"}">${view === "digest" || view === "saved" ? "Back to latest" : "Find something to follow"}</button>`}</div>`;
  }
  let rows;
  if (view === "digest")
    rows = data.sources
      .map((s) => ({
        source: s,
        items: list.filter((i) => i.sourceId === s.id),
      }))
      .filter((g) => g.items.length)
      .map(
        ({ source, items }) =>
          `<section class="digest-group"><h2>${sourceBadge(source, "small")}${esc(source.name)}<span>${items.length}</span></h2>${items.slice(0, pageSize).map(itemRow).join("")}</section>`,
      )
      .join("");
  else rows = list.slice(0, pageSize).map(itemRow).join("");
  return `<div class="result-heading"><span>${list.length} ${list.length === 1 ? "update" : "updates"}${unread ? " unread" : ""}</span><button class="text-button" data-action="read-all">Mark these read</button></div><div class="reading-sheet">${rows}</div>${(view === "digest" ? data.sources.some((s) => list.filter((i) => i.sourceId === s.id).length > pageSize) : list.length > pageSize) ? '<button class="secondary-button load-more" data-action="more">Show more updates</button>' : ""}`;
}
function itemRow(item) {
  const source = sourceOf(item.sourceId),
    read = isItemMarked(data.items, state, "read", item.id),
    saved = isItemMarked(data.items, state, "saved", item.id),
    isNew =
      !read &&
      sessionVisit &&
      Date.parse(item.firstSeenAt) > Date.parse(sessionVisit);
  const imageUrl = safeUrl(item.imageUrl);
  return `<article class="update-row ${read ? "is-read" : ""} ${imageUrl ? "with-photo" : ""}" data-item="${esc(item.id)}">${imageUrl ? `<a class="article-photo" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer" data-read-link="${esc(item.id)}" aria-label="Open ${esc(item.title)}">${photo(imageUrl)}</a>` : `<div class="row-source">${sourceBadge(source)}</div>`}<div class="row-content"><div class="item-meta"><span>${esc(source.name)}</span><span class="meta-date">${item.publishedAt ? "" : "Added "}${dateLabel(item.publishedAt || item.firstSeenAt)}</span>${isNew ? '<span class="new-label">New</span>' : ""}</div><h2><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer" data-read-link="${esc(item.id)}">${esc(item.title)}</a></h2>${item.summary ? `<p class="item-summary">${esc(item.summary)}</p>` : ""}<div class="row-controls"><button class="read-button" data-action="read" data-id="${esc(item.id)}" aria-pressed="${read}">${read ? icon("check") : '<span class="read-dot"></span>'}${read ? "Read" : "Mark read"}</button><button class="hide-button" data-action="hide" data-id="${esc(item.id)}">Hide</button></div></div><button class="bookmark-button ${saved ? "is-saved" : ""}" data-action="save" data-id="${esc(item.id)}" aria-label="${saved ? "Unsave" : "Save"} ${esc(item.title)}" aria-pressed="${saved}">${icon("saved")}</button></article>`;
}
function welcomeView() {
  return `<section class="welcome"><span class="welcome-symbol">${icon("heart")}</span><h2>A space for your favourite things.</h2><p>Pick something to follow and its latest updates will turn up here.</p><button class="primary-button" data-action="browse">${icon("search")}Find something to follow</button><p class="local-note">You can change your list whenever you like.</p></section>`;
}
function followingView() {
  if (!state.following.length) return welcomeView();
  return `<div class="following-list">${state.following
    .map((id) => {
      const s = sourceOf(id);
      return `<section class="followed-source"><div class="followed-top">${sourceBadge(s)}<div><h2>${esc(s.name)}</h2><a href="${esc(safeUrl(s.website))}" target="_blank" rel="noopener noreferrer">${esc(new URL(s.website).hostname)} ${icon("external")}</a></div><button class="secondary-button unfollow" data-action="unfollow" data-id="${esc(id)}">Unfollow</button></div><p>${esc(s.description)}</p><label class="keyword-label" for="keywords-${esc(id)}">Only show updates mentioning</label><div class="keyword-field"><input id="keywords-${esc(id)}" maxlength="200" value="${esc(state.keywords[id] || "")}" placeholder="All updates, or words separated by commas" aria-describedby="keyword-help-${esc(id)}" /><button class="secondary-button" data-action="keywords" data-id="${esc(id)}">Save</button></div><small id="keyword-help-${esc(id)}">Matches any phrase you enter. Leave blank to see everything.</small><p class="source-health ${s.error ? "has-error" : ""}">${s.error ? `Couldn’t reach this source. Showing the last available updates.${s.lastSuccessAt ? ` Last reached ${ago(s.lastSuccessAt)}.` : ""}` : `Checked ${ago(s.checkedAt || data.generatedAt)}. ${s.itemCount || 0} updates available.`}</p></section>`;
    })
    .join("")}</div>`;
}
function settingsView() {
  return `<div class="settings-sheet"><section><h2>Your catch-up</h2><p>Choose the period shown when you open Catch-up.</p><div class="segmented" role="group" aria-label="Default catch-up period"><button data-action="period" data-period="day" aria-pressed="${state.digest === "day"}">Past 24 hours</button><button data-action="period" data-period="week" aria-pressed="${state.digest === "week"}">Past 7 days</button></div></section><section><h2>Take your list with you</h2><p>Follows, keywords, read history and saved items stay in this browser. Download a backup to keep a copy or move them to another device.</p><div class="button-pair"><button class="secondary-button" data-action="export">${icon("download")}Download backup</button><label class="secondary-button file-button">Restore a backup<input type="file" accept=".json,application/json" id="import-file" /></label></div><p class="setting-detail">Restoring replaces the list on this device. Export it first if you want to keep both.</p></section><section><h2>How updates arrive</h2><p>Sources are checked roughly every four hours. Refresh loads the latest available collection; it does not contact each source immediately.</p><p>You’ll find your daily or weekly catch-up here in the app. No email or push alerts are connected.</p><p class="setting-detail">Last collection: ${exactDate(data.generatedAt)}. Some checks may run late.</p></section><section><h2>Hidden updates</h2><p>${state.muted.length ? `${state.muted.length} ${state.muted.length === 1 ? "update is" : "updates are"} hidden from your feed.` : "You haven’t hidden any updates."}</p><button class="secondary-button" data-action="unhide" ${state.muted.length ? "" : "disabled"}>Show hidden updates again</button></section><section><h2>What’s included</h2><p>Elsewhere follows the sources in its library. Keywords filter those sources; they don’t search the whole internet. New sources can be added to the library by the person maintaining this site.</p><p>Updates link to their original publishers. Pictures and short previews come from their feeds. Topic artwork is credited under About & picture credits.</p></section></div>`;
}
function refreshResults() {
  const el = document.querySelector("#results");
  if (el) {
    el.innerHTML = resultsView();
    announce(
      `${filtered().length} ${filtered().length === 1 ? "update" : "updates"}`,
    );
  }
}
function openDialog(html) {
  lastFocus = document.activeElement;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  dialog.close();
  (lastFocus?.isConnected ? lastFocus : document.querySelector("#main"))?.focus(
    { preventScroll: true },
  );
}
function browse() {
  changeView("explore");
  document.querySelector("#explore-search")?.focus({ preventScroll: true });
}
function changeView(next) {
  view = next;
  query = "";
  sourceFilter = "all";
  unread = false;
  pageSize = 30;
  render();
  document.querySelector("#main")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
function toggle(list, value) {
  const i = list.indexOf(value);
  i === -1 ? list.push(value) : list.splice(i, 1);
}
async function loadData() {
  const response = await fetch(
    new URL("../data/updates.json", import.meta.url),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("The feed could not be loaded.");
  const next = await response.json();
  if (
    !Array.isArray(next.sources) ||
    !Array.isArray(next.items) ||
    !Number.isFinite(Date.parse(next.generatedAt))
  )
    throw new Error("The feed has an unexpected format.");
  return next;
}
async function refresh() {
  if (busy) return;
  busy = true;
  render();
  try {
    const previous = data.generatedAt;
    data = await loadData();
    state = validateState(state, data.sources);
    persist();
    toast(
      previous === data.generatedAt
        ? "You have the latest collection."
        : "Your feed is up to date.",
    );
  } catch {
    toast(
      "Couldn’t load the latest collection. Your current updates are still here.",
    );
  } finally {
    busy = false;
    render();
  }
}
document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-read-link]");
  if (link && state) {
    state.read = [
      ...new Set([
        ...state.read,
        ...relatedItemIds(data.items, state, link.dataset.readLink),
      ]),
    ];
    persist();
    setTimeout(render, 50);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  event.preventDefault();
  const { action, id } = button.dataset;
  if (action === "retry") {
    boot();
    return;
  }
  if (!state) return;
  if (action === "view") {
    changeView(button.dataset.view);
    return;
  }
  if (action === "home" || action === "latest") {
    changeView("latest");
    return;
  }
  if (action === "browse") {
    browse();
    return;
  }
  if (action === "close") {
    closeDialog();
    return;
  }
  if (action === "refresh") {
    await refresh();
    return;
  }
  if (action === "source") {
    changeView("latest");
    sourceFilter = id;
    render();
    return;
  }
  if (
    action === "suggestion" ||
    action === "explore-category" ||
    action === "reset-explore"
  ) {
    if (action === "explore-category")
      exploreCategory = button.dataset.category;
    else {
      exploreQuery = action === "suggestion" ? button.dataset.query : "";
      exploreCategory = "All";
      const input = document.querySelector("#explore-search");
      if (input) input.value = exploreQuery;
    }
    updateExplore();
    return;
  }
  if (action === "follow") {
    const s = sourceOf(id);
    if (!s) return;
    toggle(state.following, id);
    sourceFilter = "all";
    persist();
    render();
    document
      .querySelector(`[data-action="follow"][data-id="${id}"]`)
      ?.focus({ preventScroll: true });
    announce(
      `${state.following.includes(id) ? "Following" : "Unfollowed"} ${s.name}`,
    );
    return;
  }
  if (action === "unfollow") {
    state.following = state.following.filter((x) => x !== id);
    persist();
    render();
    toast(`Unfollowed ${sourceOf(id).name}. Saved updates are kept.`);
    return;
  }
  if (action === "keywords") {
    state.keywords[id] = document.getElementById(`keywords-${id}`).value.trim();
    persist();
    toast(`Keywords saved for ${sourceOf(id).name}.`);
    return;
  }
  if (action === "save" || action === "read") {
    const kind = action === "save" ? "saved" : "read";
    const related = relatedItemIds(data.items, state, id);
    const adding = !isItemMarked(data.items, state, kind, id);
    state[kind] = adding
      ? [...new Set([...state[kind], ...related])]
      : state[kind].filter((value) => !related.includes(value));
    if (action === "save") {
      state.savedItems ||= {};
      for (const relatedId of related) {
        if (adding) {
          const item = data.items.find((i) => i.id === relatedId);
          if (item) state.savedItems[relatedId] = { ...item };
        } else delete state.savedItems[relatedId];
      }
    }
    persist();
    render();
    document
      .querySelector(`[data-action="${action}"][data-id="${id}"]`)
      ?.focus({ preventScroll: true });
    announce(
      action === "save"
        ? state.saved.includes(id)
          ? "Saved for later"
          : "Removed from saved"
        : state.read.includes(id)
          ? "Marked read"
          : "Marked unread",
    );
    return;
  }
  if (action === "hide") {
    state.muted = [
      ...new Set([...state.muted, ...relatedItemIds(data.items, state, id)]),
    ];
    persist();
    render();
    toast("Update hidden. You can bring it back in Settings.");
    return;
  }
  if (action === "read-all") {
    state.read = [
      ...new Set([
        ...state.read,
        ...filtered().flatMap((i) => relatedItemIds(data.items, state, i.id)),
      ]),
    ];
    persist();
    render();
    toast("These updates are marked read.");
    return;
  }
  if (action === "unread") {
    unread = !unread;
    render();
    document.querySelector('[data-action="unread"]')?.focus();
    return;
  }
  if (action === "clear-filters") {
    query = "";
    sourceFilter = "all";
    unread = false;
    render();
    return;
  }
  if (action === "more") {
    pageSize += 30;
    refreshResults();
    return;
  }
  if (action === "period") {
    state.digest = button.dataset.period;
    persist();
    render();
    document.querySelector(`[data-period="${state.digest}"]`)?.focus();
    return;
  }
  if (action === "unhide") {
    state.muted = [];
    persist();
    render();
    toast("Hidden updates are back in your feed.");
    return;
  }
  if (action === "export") {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `elsewhere-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Backup download started.");
    return;
  }
  if (action === "about")
    openDialog(
      `<div class="dialog-header"><h2>About Elsewhere</h2><button class="icon-button" data-action="close" aria-label="Close about">${icon("close")}</button></div><div class="dialog-body about-copy"><p>A small place for the things you follow.</p><p>Headlines, short previews and article pictures come from the listed publishers. Each update links to its original source. Fan news sites are labelled in their descriptions. Elsewhere is not affiliated with Pokémon or the other publishers.</p><p>Your list stays in this browser. No account needed. Pictures load from their publishers; those websites receive the image request. Elsewhere adds no analytics or adverts.</p><p>Collections run roughly every four hours. The site shows the most recent successful check, including delays or source failures.</p><h3>Picture credits</h3><p>Pokémon images © Nintendo / Creatures Inc. / GAME FREAK inc. Topic pictures link to their original pages below. Other pictures belong to their respective publishers.</p><ul class="credits-list">${data.sources
        .filter((s) => s.imagePage && safeUrl(s.imagePage))
        .map(
          (s) =>
            `<li><a href="${esc(safeUrl(s.imagePage))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></li>`,
        )
        .join(
          "",
        )}</ul><p>Saved items keep their headline, preview and original link on this device, even after they leave the main feed. Include them in a backup to keep a separate copy.</p></div><div class="dialog-footer"><button class="primary-button" data-action="close">Close</button></div>`,
    );
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    query = event.target.value;
    pageSize = 30;
    refreshResults();
  }
  if (event.target.id === "explore-search") {
    exploreQuery = event.target.value;
    updateExplore();
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "source-filter") {
    sourceFilter = event.target.value;
    pageSize = 30;
    refreshResults();
  }
  if (event.target.id === "import-file") {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2000000) throw new Error("That backup is too large.");
      const restored = validateState(
        JSON.parse(await file.text()),
        data.sources,
      );
      openDialog(
        `<div class="dialog-header"><h2>Restore this backup?</h2><button class="icon-button" data-action="close" aria-label="Cancel restore">${icon("close")}</button></div><div class="dialog-body"><p>This will replace this device’s list with ${restored.following.length} follows and ${restored.saved.length} saved ${restored.saved.length === 1 ? "item" : "items"} from the backup.</p></div><div class="dialog-footer"><button class="secondary-button" data-action="close">Cancel</button><button class="primary-button" id="confirm-restore">Restore backup</button></div>`,
      );
      document.querySelector("#confirm-restore").addEventListener(
        "click",
        () => {
          state = restored;
          persist();
          closeDialog();
          render();
          toast("Your backup has been restored.");
        },
        { once: true },
      );
    } catch (error) {
      toast(
        error instanceof SyntaxError
          ? "That file is not a valid Elsewhere backup."
          : error.message,
      );
    }
    event.target.value = "";
  }
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeDialog();
  }
});
dialog.addEventListener("close", () =>
  (lastFocus?.isConnected ? lastFocus : document.querySelector("#main"))?.focus(
    { preventScroll: true },
  ),
);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && event.newValue && data) {
    try {
      state = validateState(JSON.parse(event.newValue), data.sources);
      render();
    } catch {
      /* Keep this tab's valid state. */
    }
  }
});
async function boot() {
  try {
    data = await loadData();
    state = defaultState();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) state = validateState(JSON.parse(saved), data.sources);
    } catch {
      storageWarning =
        "Your previous list could not be opened. You can restore a backup in Settings.";
    }
    view = state.following.length ? "latest" : "explore";
    sessionVisit = state.lastVisit;
    state.lastVisit = new Date().toISOString();
    persist();
    render();
  } catch {
    app.innerHTML = `<main class="boot"><span class="wordmark">elsewhere<span>.</span></span><h1>Couldn’t open your updates.</h1><p>Check your connection and try again. Your saved list has not been changed.</p><button class="primary-button" data-action="retry">Try again</button></main>`;
  }
}
document.addEventListener(
  "error",
  (event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const image = event.target;
    image.hidden = true;
    if (image.closest(".shelf-photo"))
      image.closest(".shelf-photo").hidden = true;
    const articlePhoto = image.closest(".article-photo");
    if (articlePhoto) {
      const row = articlePhoto.closest(".update-row");
      row.classList.remove("with-photo");
      row.classList.add("photo-failed");
      articlePhoto.hidden = true;
    }
  },
  true,
);
boot();
