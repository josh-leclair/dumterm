// Capability-coverage smoke test: every `ctx.<key>` a plugin uses must actually be
// provided by buildCtx() in renderer.js. Catches the "ctx.X is not a function"
// class of load failure (e.g. a plugin written against ctx.registerOperation or
// ctx.markdown before the core grew them) WITHOUT needing to launch Electron.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");

const bcStart = renderer.indexOf("function buildCtx");
const bcEnd = renderer.indexOf("return ctx;", bcStart);
if (bcStart < 0 || bcEnd < 0) throw new Error("could not locate buildCtx() in renderer.js");
const buildCtx = renderer.slice(bcStart, bcEnd);

// a top-level ctx capability is defined in the ctx object literal as `key:` (or the
// `name,` shorthand). We only validate the top-level key — nested calls like
// ctx.events.emit or ctx.markdown.list ride on the top-level `events` / `markdown`.
function provides(key) {
  return new RegExp("\\b" + key.replace(/[$]/g, "\\$&") + "\\s*[:,]").test(buildCtx);
}

const pluginDir = path.join(root, "plugins");
const files = fs.readdirSync(pluginDir).filter((f) => f.endsWith(".js"));
let checks = 0;
const missing = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(pluginDir, file), "utf8");
  const used = new Set();
  let m;
  const re = /\bctx\.([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(src))) used.add(m[1]);
  for (const key of used) {
    checks++;
    if (!provides(key)) missing.push(file + " -> ctx." + key);
  }
}

assert.strictEqual(missing.length, 0, "plugins use ctx capabilities the core does not provide:\n  " + missing.join("\n  "));
console.log("plugin capability smoke test passed (" + files.length + " plugins, " + checks + " ctx uses, all provided by buildCtx)");
