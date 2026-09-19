import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultState,
  validateState,
  safeUrl,
  escapeHtml,
  selectedItems,
  searchSources,
  matchesKeywords,
  relatedItemIds,
  isItemMarked,
} from "../src/model.js";

const sources = [{ id: "game" }, { id: "books" }];
const items = [
  {
    id: "one",
    sourceId: "game",
    title: "An update for Stardew Valley",
    summary: "New fixes",
    url: "https://example.com/one",
    publishedAt: "2026-09-18T12:00:00Z",
  },
  {
    id: "two",
    sourceId: "books",
    title: "A new book",
    url: "https://example.com/two",
    publishedAt: "2026-09-12T12:00:00Z",
  },
  {
    id: "three",
    sourceId: "game",
    title: "Old news",
    url: "https://example.com/three",
    publishedAt: "2026-07-01T12:00:00Z",
  },
  {
    id: "bad",
    sourceId: "game",
    title: "<img onerror=alert(1)>",
    url: "javascript:alert(1)",
    publishedAt: "2026-09-19T12:00:00Z",
  },
];
test("only follows appear, unsafe links never do, and keyword filtering is literal", () => {
  const state = {
    ...defaultState(),
    following: ["game"],
    keywords: { game: "Stardew, C++" },
  };
  assert.deepEqual(
    selectedItems(items, state).map((x) => x.id),
    ["one"],
  );
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(
    escapeHtml('<img onerror="alert(1)">'),
    "&lt;img onerror=&quot;alert(1)&quot;&gt;",
  );
});
test("saved updates remain accessible after unfollow or hide", () => {
  const state = {
    ...defaultState(),
    following: [],
    saved: ["one"],
    muted: ["one"],
  };
  assert.deepEqual(
    selectedItems(items, state, { view: "saved" }).map((x) => x.id),
    ["one"],
  );
});
test("daily and weekly digests filter by real dates, without hiding read posts", () => {
  const state = {
    ...defaultState(),
    following: ["game", "books"],
    read: ["one"],
  };
  const options = { view: "digest", now: Date.parse("2026-09-19T10:00:00Z") };
  assert.deepEqual(
    selectedItems(items, state, options).map((x) => x.id),
    ["one", "two"],
  );
  assert.deepEqual(
    selectedItems(items, { ...state, digest: "day" }, options).map((x) => x.id),
    ["one"],
  );
  assert.deepEqual(
    selectedItems(items, state, { ...options, unread: true }).map((x) => x.id),
    ["two"],
  );
});
test("imports reject unrelated files and discard unavailable sources and malformed values", () => {
  assert.throws(() => validateState({ hello: "world" }, sources));
  const restored = validateState(
    {
      ...defaultState(),
      following: ["game", "game", "missing"],
      keywords: { game: "Patch", missing: "x" },
      saved: ["one", 22],
      digest: "invalid",
    },
    sources,
  );
  assert.deepEqual(restored.following, ["game"]);
  assert.deepEqual(restored.keywords, { game: "Patch" });
  assert.deepEqual(restored.saved, ["one"]);
  assert.equal(restored.digest, "week");
});
test("undated posts enter catch-up by first seen date and then age out", () => {
  const state = { ...defaultState(), following: ["books"] };
  const undated = [
    { ...items[1], publishedAt: null, firstSeenAt: "2026-09-18T12:00:00Z" },
  ];
  assert.equal(
    selectedItems(undated, state, {
      view: "digest",
      now: Date.parse("2026-09-19T12:00:00Z"),
    }).length,
    1,
  );
  assert.equal(
    selectedItems(undated, state, {
      view: "digest",
      now: Date.parse("2026-09-28T12:00:00Z"),
    }).length,
    0,
  );
});
test("saved snapshots survive feed rotation and backup round trips", () => {
  const original = {
    ...defaultState(),
    saved: ["one"],
    savedItems: { one: items[0] },
  };
  const restored = validateState(JSON.parse(JSON.stringify(original)), sources);
  assert.equal(
    selectedItems([], restored, { view: "saved" })[0].url,
    items[0].url,
  );
  assert.equal(
    selectedItems([], restored, { view: "saved" })[0].title,
    items[0].title,
  );
});
test("shared URLs are deduplicated after selecting followed sources", () => {
  const shared = [items[0], { ...items[0], id: "copy", sourceId: "books" }];
  assert.equal(
    selectedItems(shared, { ...defaultState(), following: ["books"] })[0].id,
    "copy",
  );
  assert.equal(
    selectedItems(shared, { ...defaultState(), following: ["books", "game"] })
      .length,
    1,
  );
});

test("discovery search matches unaccented Pokemon, aliases, multiple words and category", () => {
  const catalogue = [
    {
      id: "cards",
      name: "Pokémon cards",
      category: "Pokémon",
      aliases: ["TCG", "boosters", "trading cards"],
    },
    {
      id: "plush",
      name: "Pokémon merchandise",
      category: "Pokémon",
      aliases: ["plushies"],
    },
    {
      id: "ac",
      name: "Animal Crossing",
      category: "Games",
      aliases: ["cosy", "cozy"],
      publisher: "Nintendo Life",
    },
  ];
  assert.deepEqual(
    searchSources(catalogue, "pokemon").map((s) => s.id),
    ["cards", "plush"],
  );
  assert.deepEqual(
    searchSources(catalogue, "tcg pokemon").map((s) => s.id),
    ["cards"],
  );
  assert.deepEqual(
    searchSources(catalogue, "plushies").map((s) => s.id),
    ["plush"],
  );
  assert.equal(searchSources(catalogue, "cosy", "Pokémon").length, 0);
  assert.equal(searchSources(catalogue, "cosy", "Games")[0].id, "ac");
  assert.equal(searchSources(catalogue, "nintendo")[0].id, "ac");
  assert.equal(searchSources(catalogue, "no such source").length, 0);
});

test("article search supports accents and unordered terms while keywords remain literal", () => {
  const story = { ...items[0], title: "New Pokémon TCG cards" };
  const state = { ...defaultState(), following: ["game"] };
  assert.equal(
    selectedItems([story], state, { query: "cards pokemon" }).length,
    1,
  );
  assert.equal(matchesKeywords(story, "pokemon"), true);
  assert.equal(matchesKeywords({ title: "C programming" }, "C++"), false);
  assert.equal(matchesKeywords({ title: "C++ programming" }, "C++"), true);
});

test("saved images round trip and unsafe image URLs are discarded", () => {
  const saved = { ...items[0], imageUrl: "https://example.com/picture.jpg" };
  const state = {
    ...defaultState(),
    saved: ["one"],
    savedItems: { one: saved },
  };
  assert.equal(
    validateState(JSON.parse(JSON.stringify(state)), sources).savedItems.one
      .imageUrl,
    saved.imageUrl,
  );
  saved.imageUrl = "javascript:alert(1)";
  assert.equal(validateState(state, sources).savedItems.one.imageUrl, "");
});

test("shared stories stay hidden or read across overlapping topic subscriptions", () => {
  const shared = [items[0], { ...items[0], id: "copy", sourceId: "books" }];
  const state = {
    ...defaultState(),
    following: ["game", "books"],
    read: ["one"],
  };
  assert.deepEqual(relatedItemIds(shared, state, "one"), ["one", "copy"]);
  assert.equal(isItemMarked(shared, state, "read", "copy"), true);
  assert.equal(selectedItems(shared, state, { unread: true }).length, 0);
  state.muted = ["one"];
  assert.equal(selectedItems(shared, state).length, 0);
  state.saved = ["one"];
  assert.equal(selectedItems(shared, state, { view: "saved" }).length, 1);
});
