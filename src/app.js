import {
  STORAGE_KEY,
  defaultState,
  validateState,
  safeUrl,
  escapeHtml as esc,
  selectedItems,
} from "./model.js";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
let data,
  state,
  view = "latest",
  query = "",
  sourceFilter = "all",
  unread = false,
  pageSize = 30,
  busy = false,
  storageWarning = "",
  sessionVisit = null,
  lastFocus,
  toastTimer;
const icons = {
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
  const color = /^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : "#245a9b";
  return `<span class="source-badge ${extra}" style="--source-color:${color}" aria-hidden="true">${esc(s.initials || s.name.slice(0, 2))}</span>`;
}
function navigation() {
  return [
    [
      "latest",
      "Latest",
      selectedItems(data.items, state, { unread: true }).length,
    ],
    ["digest", "Catch-up", null],
    [
      "saved",
      "Saved",
      state.saved.filter(
        (id) => data.items.some((i) => i.id === id) || state.savedItems?.[id],
      ).length,
    ],
    ["following", "Following", state.following.length],
  ]
    .map(
      ([id, label, count]) =>
        `<button class="nav-button ${view === id ? "active" : ""}" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ""}</button>`,
    )
    .join("");
}
function render() {
  const headings = {
    latest: "Latest updates",
    digest: "A little catch-up",
    saved: "Saved for later",
    following: "Your follows",
    settings: "Settings",
  };
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  app.innerHTML = `<div class="layout"><aside class="sidebar"><a class="wordmark" href="#" data-action="home" aria-label="Elsewhere home">elsewhere<span>.</span></a><nav class="primary-nav" aria-label="Main navigation">${navigation()}</nav><div class="sidebar-sources"><div class="sidebar-heading"><span>On your list</span><button class="icon-button" data-action="browse" aria-label="Find sources">${icon("plus")}</button></div>${
    state.following.length
      ? state.following
          .map((id) => {
            const s = sourceOf(id);
            return `<button class="sidebar-source ${sourceFilter === id ? "selected" : ""}" data-action="source" data-id="${esc(id)}">${sourceBadge(s, "small")}<span>${esc(s.name)}</span></button>`;
          })
          .join("")
      : '<p class="sidebar-note">Add a few things you’d like to keep up with.</p>'
  }</div><div class="sidebar-footer"><button class="settings-link ${view === "settings" ? "active" : ""}" data-action="view" data-view="settings">${icon("settings")}Settings</button><p title="${esc(exactDate(data.generatedAt))}">Sources checked ${ago(data.generatedAt)}</p></div></aside><div class="content"><header class="topbar"><span class="today">${today}</span><button class="text-button refresh" data-action="refresh" ${busy ? "disabled" : ""}>${icon("refresh", busy ? "spinning" : "")}<span>${busy ? "Checking…" : "Refresh"}</span></button></header><main id="main" tabindex="-1">${storageWarning ? `<div class="notice warning">${esc(storageWarning)}</div>` : ""}${Date.now() - Date.parse(data.generatedAt) > 86400000 ? `<div class="notice warning">These updates were last checked ${ago(data.generatedAt)}. The next collection may be delayed.</div>` : ""}<div class="page-heading"><div><h1>${headings[view]}</h1><p>${view === "latest" ? (state.following.length ? `From ${state.following.length} ${state.following.length === 1 ? "source" : "sources"} you follow.` : "Choose what you want to keep up with.") : view === "saved" ? "The things you wanted to come back to." : view === "digest" ? "Recent updates from the things you follow." : view === "following" ? "Choose what belongs on your list." : "Your list, your way."}</p></div>${view !== "settings" ? `<button class="primary-button" data-action="browse">${icon("plus")}<span>Find sources</span></button>` : ""}</div>${view === "following" ? followingView() : view === "settings" ? settingsView() : readingView()}</main><footer class="page-footer"><span>Sources checked ${ago(data.generatedAt)}</span><button data-action="about">About Elsewhere</button></footer></div></div>`;
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
    return `<div class="empty-state"><span class="empty-icon">${icon(view === "saved" ? "saved" : "check")}</span><h2>${hasFilters ? "Nothing matches just yet." : view === "saved" ? "Keep something for later." : view === "digest" ? "A quiet few days." : "Nothing new on your list."}</h2><p>${hasFilters ? "Try another search, or clear your filters." : view === "saved" ? "Use the bookmark beside an update. You’ll find it here when you’re ready." : view === "digest" ? "There are no updates in this period. Older posts are still in Latest." : "You can add another source or adjust your keywords in Following."}</p>${hasFilters ? '<button class="secondary-button" data-action="clear-filters">Clear filters</button>' : `<button class="secondary-button" data-action="${view === "digest" || view === "saved" ? "latest" : "browse"}">${view === "digest" || view === "saved" ? "Back to latest" : "Find sources"}</button>`}</div>`;
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
    read = state.read.includes(item.id),
    saved = state.saved.includes(item.id),
    isNew =
      !read &&
      sessionVisit &&
      Date.parse(item.firstSeenAt) > Date.parse(sessionVisit);
  return `<article class="update-row ${read ? "is-read" : ""}" data-item="${esc(item.id)}"><div class="row-source">${sourceBadge(source)}</div><div class="row-content"><div class="item-meta"><span>${esc(source.name)}</span><span class="meta-date">${item.publishedAt ? "" : "Added "}${dateLabel(item.publishedAt || item.firstSeenAt)}</span>${isNew ? '<span class="new-label">New</span>' : ""}</div><h2><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer" data-read-link="${esc(item.id)}">${esc(item.title)}${icon("external")}</a></h2>${item.summary ? `<p class="item-summary">${esc(item.summary)}</p>` : ""}<div class="row-controls"><button class="read-button" data-action="read" data-id="${esc(item.id)}" aria-pressed="${read}">${read ? icon("check") : '<span class="read-dot"></span>'}${read ? "Read" : "Mark read"}</button><button class="hide-button" data-action="hide" data-id="${esc(item.id)}">Hide</button></div></div><button class="bookmark-button ${saved ? "is-saved" : ""}" data-action="save" data-id="${esc(item.id)}" aria-label="${saved ? "Unsave" : "Save"} ${esc(item.title)}" aria-pressed="${saved}">${icon("saved")}</button></article>`;
}
function welcomeView() {
  return `<section class="welcome"><div class="welcome-title"><span class="welcome-symbol">${icon("following")}</span><h2>Start with a few favourites.</h2><p>Follow a source to put its latest updates here. You can change your list whenever you like.</p></div><div class="welcome-sources">${data.sources
    .filter(
      (source, index, sources) =>
        sources.findIndex(
          (candidate) => candidate.category === source.category,
        ) === index,
    )
    .slice(0, 4)
    .map(
      (s) =>
        `<button class="welcome-source" data-action="follow" data-id="${esc(s.id)}">${sourceBadge(s)}<span><strong>${esc(s.name)}</strong><small>${esc(s.category)}</small></span>${icon("plus")}</button>`,
    )
    .join(
      "",
    )}</div><button class="primary-button" data-action="browse">Browse all ${data.sources.length} sources</button><p class="local-note">Your follows are saved on this device. No account needed.</p></section>`;
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
  return `<div class="settings-sheet"><section><h2>Your catch-up</h2><p>Choose the period shown when you open Catch-up.</p><div class="segmented" role="group" aria-label="Default catch-up period"><button data-action="period" data-period="day" aria-pressed="${state.digest === "day"}">Past 24 hours</button><button data-action="period" data-period="week" aria-pressed="${state.digest === "week"}">Past 7 days</button></div></section><section><h2>Take your list with you</h2><p>Follows, keywords, read history and saved items stay in this browser. Download a backup to keep a copy or move them to another device.</p><div class="button-pair"><button class="secondary-button" data-action="export">${icon("download")}Download backup</button><label class="secondary-button file-button">Restore a backup<input type="file" accept=".json,application/json" id="import-file" /></label></div><p class="setting-detail">Restoring replaces the list on this device. Export it first if you want to keep both.</p></section><section><h2>How updates arrive</h2><p>Sources are checked roughly every four hours. Refresh loads the latest available collection; it does not contact each source immediately.</p><p>You’ll find your daily or weekly catch-up here in the app. No email or push alerts are connected.</p><p class="setting-detail">Last collection: ${exactDate(data.generatedAt)}. Some checks may run late.</p></section><section><h2>Hidden updates</h2><p>${state.muted.length ? `${state.muted.length} ${state.muted.length === 1 ? "update is" : "updates are"} hidden from your feed.` : "You haven’t hidden any updates."}</p><button class="secondary-button" data-action="unhide" ${state.muted.length ? "" : "disabled"}>Show hidden updates again</button></section><section><h2>What’s included</h2><p>Elsewhere follows the sources in its library. Keywords filter those sources; they don’t search the whole internet. New sources can be added to the library by the person maintaining this site.</p><p>Updates link to their original publishers. Short previews come from their feeds.</p></section></div>`;
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
  openDialog(
    `<div class="dialog-header"><div><h2>Find something to follow</h2><p>Choose sources for your reading list.</p></div><button class="icon-button" data-action="close" aria-label="Close sources">${icon("close")}</button></div><div class="dialog-body"><label class="search-field library-search">${icon("search")}<input id="library-search" type="search" placeholder="Search sources or interests" aria-label="Search sources or interests" autocomplete="off" /></label><div class="category-tabs" role="group" aria-label="Source category">${["All", ...new Set(data.sources.map((s) => s.category))].map((c, i) => `<button data-action="category" data-category="${esc(c)}" aria-pressed="${i === 0}">${esc(c)}</button>`).join("")}</div><div id="source-library">${libraryRows()}</div><p class="library-note">These are the available sources. Once you follow one, add keywords in Following to narrow it down.</p></div><div class="dialog-footer"><span id="follow-count">${state.following.length} following</span><button class="primary-button" data-action="close">Done</button></div>`,
  );
}
function libraryRows(search = "", category = "All") {
  const list = data.sources.filter(
    (s) =>
      (category === "All" || s.category === category) &&
      `${s.name} ${s.category} ${s.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return list.length
    ? list
        .map(
          (s) =>
            `<div class="library-source">${sourceBadge(s)}<div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><span class="library-category">${esc(s.category)}${s.error ? " · Temporarily unavailable" : ""}</span></div><button class="follow-button ${state.following.includes(s.id) ? "is-following" : ""}" data-action="follow" data-id="${esc(s.id)}" aria-pressed="${state.following.includes(s.id)}" aria-label="${state.following.includes(s.id) ? "Unfollow" : "Follow"} ${esc(s.name)}">${icon(state.following.includes(s.id) ? "check" : "plus")}<span>${state.following.includes(s.id) ? "Following" : "Follow"}</span></button></div>`,
        )
        .join("")
    : '<div class="library-empty"><h3>No matching sources.</h3><p>Try a broader search or another category.</p></div>';
}
function updateLibrary() {
  const search = document.querySelector("#library-search");
  if (!search) return;
  const category =
    dialog.querySelector('[data-category][aria-pressed="true"]')?.dataset
      .category || "All";
  document.querySelector("#source-library").innerHTML = libraryRows(
    search.value,
    category,
  );
  document.querySelector("#follow-count").textContent =
    `${state.following.length} following`;
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
    if (!state.read.includes(link.dataset.readLink))
      state.read.push(link.dataset.readLink);
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
  if (action === "category") {
    dialog
      .querySelectorAll("[data-category]")
      .forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
    updateLibrary();
    return;
  }
  if (action === "follow") {
    const s = sourceOf(id);
    if (!s) return;
    toggle(state.following, id);
    sourceFilter = "all";
    persist();
    render();
    updateLibrary();
    dialog.querySelector(`[data-action="follow"][data-id="${id}"]`)?.focus();
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
    toggle(state[action === "save" ? "saved" : "read"], id);
    if (action === "save") {
      state.savedItems ||= {};
      if (state.saved.includes(id)) {
        const item = data.items.find((i) => i.id === id);
        if (item) state.savedItems[id] = { ...item };
      } else delete state.savedItems[id];
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
    if (!state.muted.includes(id)) state.muted.push(id);
    persist();
    render();
    toast("Update hidden. You can bring it back in Settings.");
    return;
  }
  if (action === "read-all") {
    state.read = [...new Set([...state.read, ...filtered().map((i) => i.id)])];
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
      `<div class="dialog-header"><h2>About Elsewhere</h2><button class="icon-button" data-action="close" aria-label="Close about">${icon("close")}</button></div><div class="dialog-body about-copy"><p>A small place for the things you follow.</p><p>Headlines and short previews come from the listed publishers. Each update links to its original source.</p><p>Your list stays in this browser. There are no accounts, adverts or tracking scripts.</p><p>Collections run roughly every four hours. The site shows the most recent successful check, including delays or source failures.</p><p>Saved items keep their headline, preview and original link on this device, even after they leave the main feed. Include them in a backup to keep a separate copy.</p></div><div class="dialog-footer"><button class="primary-button" data-action="close">Close</button></div>`,
    );
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    query = event.target.value;
    pageSize = 30;
    refreshResults();
  }
  if (event.target.id === "library-search") updateLibrary();
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
    sessionVisit = state.lastVisit;
    state.lastVisit = new Date().toISOString();
    persist();
    render();
  } catch {
    app.innerHTML = `<main class="boot"><span class="wordmark">elsewhere<span>.</span></span><h1>Couldn’t open your updates.</h1><p>Check your connection and try again. Your saved list has not been changed.</p><button class="primary-button" data-action="retry">Try again</button></main>`;
  }
}
boot();
