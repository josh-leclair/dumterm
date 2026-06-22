const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pluginDir = path.join(__dirname, "..", "plugins");
const shadowed = [
  "ctx", "window", "document", "dum", "require", "process", "globalThis",
  "module", "exports", "__dirname", "fetch", "XMLHttpRequest", "localStorage", "indexedDB",
  "Function",
];
const files = fs.readdirSync(pluginDir).filter((file) => file.endsWith(".js"));

for (const file of files) {
  const source = fs.readFileSync(path.join(pluginDir, file), "utf8");
  assert.doesNotThrow(() => new Function(...shadowed, '"use strict";\n' + source), `${file} must load in Dumterm's strict plugin sandbox`);
}

console.log(`strict plugin loader smoke test passed (${files.length} plugins)`);
