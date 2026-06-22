// Logic smoke test for the inline editor's text-buffer ops (the off-by-one-prone
// core: insert, newline split, backspace/delete with line joins, multi-line type).
// Slices the pure edits out of renderer.js and runs them against a fake textEditor.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const start = src.indexOf("function edLine");
const end = src.indexOf("function renderEditor");
if (start < 0 || end < 0) throw new Error("could not locate editor buffer ops");

function load(text) {
  const te = { lines: text.split("\n"), cy: 0, cx: 0, top: 0, left: 0, dirty: false };
  const sandbox = { textEditor: te };
  vm.runInNewContext(src.slice(start, end), sandbox, { filename: "editor-ops.js" });
  sandbox.te = te;
  return sandbox;
}
const at = (s, cy, cx) => { s.te.cy = cy; s.te.cx = cx; };

// insert at end / middle
let s = load("hello"); at(s, 0, 5); s.edInsert("!");
assert.strictEqual(s.te.lines.join("\n"), "hello!");
assert.strictEqual(s.te.cx, 6);
assert.strictEqual(s.te.dirty, true);

s = load("hllo"); at(s, 0, 1); s.edInsert("e");
assert.strictEqual(s.te.lines[0], "hello");

// enter splits the line
s = load("abcd"); at(s, 0, 2); s.edEnter();
assert.deepStrictEqual(s.te.lines, ["ab", "cd"]);
assert.strictEqual(s.te.cy, 1);
assert.strictEqual(s.te.cx, 0);

// backspace within a line, and at col 0 joins with the previous line
s = load("abc"); at(s, 0, 2); s.edBackspace();
assert.strictEqual(s.te.lines[0], "ac");
assert.strictEqual(s.te.cx, 1);

s = load("ab\ncd"); at(s, 1, 0); s.edBackspace();
assert.deepStrictEqual(s.te.lines, ["abcd"]);
assert.strictEqual(s.te.cy, 0);
assert.strictEqual(s.te.cx, 2);

// backspace at very start is a no-op
s = load("abc"); at(s, 0, 0); s.edBackspace();
assert.deepStrictEqual(s.te.lines, ["abc"]);

// delete within a line, and at EOL pulls up the next line
s = load("abc"); at(s, 0, 1); s.edDelete();
assert.strictEqual(s.te.lines[0], "ac");

s = load("ab\ncd"); at(s, 0, 2); s.edDelete();
assert.deepStrictEqual(s.te.lines, ["abcd"]);

// multi-line type, including CRLF normalization
s = load(""); s.edType("x\ny\nz");
assert.deepStrictEqual(s.te.lines, ["x", "y", "z"]);
assert.strictEqual(s.te.cy, 2);
assert.strictEqual(s.te.cx, 1);

s = load(""); s.edType("a\r\nb");
assert.deepStrictEqual(s.te.lines, ["a", "b"]);

console.log("inline editor buffer ops smoke test passed");
