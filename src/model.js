export const STORAGE_KEY = "elsewhere.preferences.v1";
export const defaultState = () => ({
  version: 1,
  following: [],
  read: [],
  saved: [],
  savedItems: {},
  muted: [],
  keywords: {},
  digest: "week",
  lastVisit: null,
});
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function validateState(raw, sources) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.following) ||
    !Array.isArray(raw.read) ||
    !Array.isArray(raw.saved)
  )
    throw new Error("This is not an Elsewhere backup.");
  const ids = new Set(sources.map((s) => s.id));
  const strings = (list, limit = 6000) =>
    [
      ...new Set(
        (Array.isArray(list) ? list : []).filter(
          (x) => typeof x === "string" && x.length < 200,
        ),
      ),
    ].slice(-limit);
  const savedItems = {};
  for (const [key, item] of Object.entries(raw.savedItems || {})) {
    if (
      !item ||
      item.id !== key ||
      !ids.has(item.sourceId) ||
      !safeUrl(item.url) ||
      typeof item.title !== "string"
    )
      continue;
    savedItems[key] = {
      id: key.slice(0, 200),
      sourceId: item.sourceId,
      sourceName: String(item.sourceName || "").slice(0, 200),
      title: item.title.slice(0, 800),
      url: safeUrl(item.url),
      summary: String(item.summary || "").slice(0, 220),
      publishedAt: Number.isFinite(Date.parse(item.publishedAt))
        ? item.publishedAt
        : null,
      firstSeenAt: Number.isFinite(Date.parse(item.firstSeenAt))
        ? item.firstSeenAt
        : new Date().toISOString(),
    };
  }
  const keywords = {};
  for (const [key, value] of Object.entries(raw.keywords || {}))
    if (ids.has(key) && typeof value === "string")
      keywords[key] = value.slice(0, 200);
  return {
    version: 1,
    following: strings(raw.following, 100).filter((id) => ids.has(id)),
    read: strings(raw.read),
    saved: strings(raw.saved),
    savedItems,
    muted: strings(raw.muted),
    keywords,
    digest: raw.digest === "day" ? "day" : "week",
    lastVisit:
      typeof raw.lastVisit === "string" &&
      Number.isFinite(Date.parse(raw.lastVisit))
        ? raw.lastVisit
        : null,
  };
}
export function matchesKeywords(item, keywords) {
  const terms = (keywords || "")
    .split(",")
    .map((x) => x.trim().toLocaleLowerCase())
    .filter(Boolean);
  const text = `${item.title} ${item.summary || ""}`.toLocaleLowerCase();
  return terms.length === 0 || terms.some((term) => text.includes(term));
}
export function selectedItems(
  items,
  state,
  {
    view = "latest",
    source = "all",
    query = "",
    unread = false,
    now = Date.now(),
  } = {},
) {
  const text = query.trim().toLocaleLowerCase();
  const cutoff = now - (state.digest === "day" ? 1 : 7) * 86400000;
  const seen = new Set();
  const available =
    view === "saved"
      ? [
          ...new Map(
            [...Object.values(state.savedItems || {}), ...items].map((item) => [
              item.id,
              item,
            ]),
          ).values(),
        ]
      : items;
  return available
    .filter((item) => {
      if (!safeUrl(item.url)) return false;
      if (view === "saved") {
        if (!state.saved.includes(item.id)) return false;
      } else {
        if (
          !state.following.includes(item.sourceId) ||
          state.muted.includes(item.id)
        )
          return false;
        if (!matchesKeywords(item, state.keywords[item.sourceId])) return false;
      }
      if (source !== "all" && item.sourceId !== source) return false;
      if (unread && state.read.includes(item.id)) return false;
      if (
        text &&
        !`${item.title} ${item.summary || ""} ${item.sourceName || ""}`
          .toLocaleLowerCase()
          .includes(text)
      )
        return false;
      if (
        view === "digest" &&
        (!Number.isFinite(Date.parse(item.publishedAt || item.firstSeenAt)) ||
          Date.parse(item.publishedAt || item.firstSeenAt) < cutoff)
      )
        return false;
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort(
      (a, b) =>
        (Date.parse(b.publishedAt || b.firstSeenAt) || 0) -
        (Date.parse(a.publishedAt || a.firstSeenAt) || 0),
    );
}
