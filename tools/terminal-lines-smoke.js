const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(require("path").join(__dirname, "..", "renderer.js"), "utf8");
const start = source.indexOf("function terminalText");
const end = source.indexOf("function println", start);
if (start < 0 || end < 0) throw new Error("could not locate terminal newline helper");

const sandbox = {};
vm.runInNewContext(source.slice(start, end), sandbox, { filename: "terminal-lines.js" });
const text = sandbox.terminalText("first\n  second\r\nthird\nfourth");
assert.strictEqual(text, "first\r\n  second\r\nthird\r\nfourth");
assert(!/(^|[^\r])\n/.test(text), "output must not contain a bare line feed");
console.log("terminal newline smoke test passed");
