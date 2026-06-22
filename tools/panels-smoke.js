// Logic-level smoke test for Dumterm's plugin panel regions.
// It runs the REAL renderPanels() (plus its dockCardHtml/renderDockRegion helpers)
// from renderer.js against a fake DOM so we can prove:
//   - multiple `area:"right"` panels coexist as separate compact dock cards
//   - an `area:"right-full"` panel (e.g. live twitch chat) lands in its OWN column
//     (#plugin-chat), NOT the compact dock and NOT a corner overlay, so it never
//     replaces the live/activity/rules cards
//   - hidden / empty panels are skipped
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const start = source.indexOf("function dockCardHtml");
const end = source.indexOf("function startPanels", start);
if (start < 0 || end < 0) throw new Error("could not locate renderPanels helpers");

// minimal element + document shims (only what renderPanels touches)
function makeEl() {
  const classes = new Set();
  return {
    _html: "",
    hidden: false,
    style: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
    querySelectorAll: () => [],
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
}

function run(panels, hiddenPanels) {
  const els = {
    "app-shell": makeEl(),
    "plugin-dock": makeEl(),
    "plugin-dock-panels": makeEl(),
    "plugin-dock-resizer": makeEl(),
    "plugin-chat": makeEl(),
    "plugin-chat-panels": makeEl(),
  };
  const sandbox = {
    plugins: { panels },
    THEMES: { phosphor: { background: "#000", brightBlack: "#111", foreground: "#fff" } },
    state: { config: { theme: "phosphor", hiddenPanels: hiddenPanels || [], pluginDockWidth: 340 } },
    panelEls: {},
    dockResize: { width: 340 },
    ensurePanelEl: () => makeEl(),
    ansiToHtml: (s) => String(s),
    setDockWidth: () => {},
    fitAddon: { fit: () => {} },
    requestAnimationFrame: (fn) => fn(),
    document: { getElementById: (id) => els[id] || null },
  };
  vm.runInNewContext(source.slice(start, end), sandbox, { filename: "render-panels.js" });
  sandbox.renderPanels();
  return els;
}

const panel = (id, plugin, title, render, area) => ({ id, plugin, area: area || "right", title, render });
const dockHtml = (els) => els["plugin-dock-panels"].innerHTML;
const chatHtml = (els) => els["plugin-chat-panels"].innerHTML;
const three = [
  panel("streamwatch", "streamwatch", "Twitch live", () => "ninja ● live"),
  panel("chatwatch", "chatwatch", "chat mentions", () => "bob: hello there"),
  panel("events", "eventtracker", "activity", () => "did a thing"),
];

// 1. all three visible -> three separate dock cards, dock shown
let els = run(three, []);
assert.strictEqual((dockHtml(els).match(/<section/g) || []).length, 3, "three right-dock panels must render as three cards");
for (const t of ["Twitch live", "chat mentions", "activity"]) assert(dockHtml(els).includes(t), "dock should include the " + t + " card");
assert(dockHtml(els).includes("bob: hello there"), "chat mentions content must be present alongside the others");
assert.strictEqual(els["plugin-dock"].hidden, false, "dock should be visible when panels have content");
assert(els["app-shell"].classList.has("has-dock"), "app-shell should get has-dock");

// 2. hiding one (by id) leaves the other two; the hidden one's card is gone
els = run(three, ["chatwatch"]);
assert.strictEqual((dockHtml(els).match(/<section/g) || []).length, 2, "hiding one panel leaves two cards");
assert(!dockHtml(els).includes("chat mentions"), "hidden panel must not render");

// 2b. hiding by plugin name (legacy `status` settings stored plugin names) also works
els = run(three, ["eventtracker"]);
assert(!dockHtml(els).includes("activity"), "hiding by plugin name must also hide the card");

// 3. a panel that renders empty is skipped, others still show
els = run([three[0], panel("chatwatch", "chatwatch", "chat mentions", () => ""), three[2]], []);
assert.strictEqual((dockHtml(els).match(/<section/g) || []).length, 2, "empty-render panel must be skipped");

// 4. nothing to show -> dock hidden, body cleared, has-dock removed
els = run([panel("chatwatch", "chatwatch", "chat mentions", () => "")], []);
assert.strictEqual(els["plugin-dock"].hidden, true, "dock should hide when no panel has content");
assert.strictEqual(dockHtml(els), "", "dock body should clear when empty");
assert(!els["app-shell"].classList.has("has-dock"), "has-dock should be removed when dock is empty");

// 5. a "right-full" panel (live twitch chat) gets its OWN chat column, NOT the dock,
//    and coexists with the compact dock cards — it never replaces them
els = run([
  panel("streamwatch", "streamwatch", "Twitch live", () => "ninja ● live"),
  panel("twitchchat", "twitchchat", "Twitch chat", () => "bob: hi\nsue: yo", "right-full"),
  panel("events", "eventtracker", "activity", () => "did a thing"),
], []);
assert.strictEqual((dockHtml(els).match(/<section/g) || []).length, 2, "compact dock holds only the two right cards");
assert(dockHtml(els).includes("Twitch live") && dockHtml(els).includes("activity"), "dock keeps the compact cards");
assert(!dockHtml(els).includes("Twitch chat"), "the chat panel must NOT be in the compact dock");
assert.strictEqual((chatHtml(els).match(/<section/g) || []).length, 1, "chat column holds the single full panel");
assert(chatHtml(els).includes("Twitch chat"), "chat panel renders in its own column");
assert(chatHtml(els).includes("plugin-dock-panel--full"), "chat panel must get the full-height class");
assert(els["app-shell"].classList.has("has-dock") && els["app-shell"].classList.has("has-chat"), "both regions visible together");
assert.strictEqual(els["plugin-chat"].hidden, false, "chat column visible when a right-full panel is present");

// 6. chat column alone (no compact dock) -> only has-chat, dock hidden
els = run([panel("twitchchat", "twitchchat", "Twitch chat", () => "hi", "right-full")], []);
assert(els["app-shell"].classList.has("has-chat") && !els["app-shell"].classList.has("has-dock"), "chat-only shows chat region, no dock");
assert.strictEqual(els["plugin-dock"].hidden, true, "compact dock stays hidden when only a chat panel exists");

console.log("plugin dock smoke test passed (compact dock + separate full-height chat column)");
