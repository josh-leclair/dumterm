// Logic smoke test for tab completion. Slices the real tabComplete (+ its
// longestCommonPrefix helper) out of renderer.js and runs it against a stubbed
// candidate pool, so we lock in the rule that matters: completing an argument
// must PRESERVE the command and any subcommands (e.g. `govee on bed`<tab> ->
// `govee on bedroom`, never `govee bedroom`), incl. multi-word names + prefix fill.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const start = src.indexOf("function longestCommonPrefix");
const end = src.indexOf("function helpTopicNames");
if (start < 0 || end < 0) throw new Error("could not locate tabComplete");

function load(pool) {
  const printed = [];
  const sandbox = {
    completionCandidates: () => pool,
    term: { write: () => {} },
    println: (s) => printed.push(s),
    redrawLine: () => {},
    A: { dim: (s) => s },
    printed,
  };
  vm.runInNewContext(src.slice(start, end), sandbox, { filename: "tabcomplete.js" });
  return sandbox;
}
const complete = (pool, buffer) => load(pool).tabComplete(buffer);

// THE BUG: completing the name must keep the `on` subcommand
assert.strictEqual(complete(["bedroom", "bathroom", "office"], "govee on bed"), "govee on bedroom ");
assert.strictEqual(complete(["bedroom", "bathroom", "office"], "govee on bath"), "govee on bathroom ");
assert.strictEqual(complete(["bedroom", "office"], "govee off off"), "govee off office "); // 'off' subcmd kept, name completed

// multi-word candidate, subcommand preserved, fragment spans two tokens
assert.strictEqual(complete(["living room", "office"], "govee on living roo"), "govee on living room ");
assert.strictEqual(complete(["living room", "office"], "govee color living roo"), "govee color living room ");

// common-prefix fill when ambiguous (no trailing space, keep typing)
assert.strictEqual(complete(["bedroom", "bedlamp"], "govee on be"), "govee on bed");
// already at the common prefix with >1 match -> list (returns null, prints options)
let s = load(["bedroom", "bedlamp"]);
assert.strictEqual(s.tabComplete("govee on bed"), null);
assert.strictEqual(s.printed.length, 1);
assert(s.printed[0].includes("bedroom") && s.printed[0].includes("bedlamp"));

// first-word (command) completion still works
assert.strictEqual(complete(["govee", "go"], "gov"), "govee ");
assert.strictEqual(complete(["govee", "gover"], "go"), "gove"); // fill common prefix

// no candidates / no match -> null (no crash, no junk)
assert.strictEqual(complete([], "govee on bed"), null);
assert.strictEqual(complete(["bedroom"], "govee brightness bedroom 5"), null); // value not completable

console.log("tab completion smoke test passed (subcommands preserved, multi-word + prefix fill)");
