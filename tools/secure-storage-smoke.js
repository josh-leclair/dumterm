// Logic-level smoke test for Dumterm's encrypted JSON wrapper.
// It substitutes a deterministic safeStorage shim so it can run with plain Node.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const mainPath = path.join(__dirname, "..", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const start = source.indexOf("const ENCRYPTED_DATA_MARKER =");
const end = source.indexOf("function safeStorePath", start);
if (start < 0 || end < 0) throw new Error("could not locate secure storage helpers");

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from("sealed:" + text, "utf8"),
  decryptString: (data) => {
    const text = Buffer.from(data).toString("utf8");
    if (!text.startsWith("sealed:")) throw new Error("bad encrypted data");
    return text.slice("sealed:".length);
  },
};
const sandbox = { fs, path, Buffer, safeStorage };
vm.runInNewContext(source.slice(start, end), sandbox, { filename: "secure-storage-helpers.js" });
const sameJson = (actual, expected, message) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dumterm-secure-storage-"));
try {
  const configPath = path.join(dir, "config.json");
  const commandsPath = path.join(dir, "commands.json");
  const legacy = { controlToken: "legacy-token", plugins: { spotify: { clientSecret: "legacy-secret" } } };
  fs.writeFileSync(configPath, JSON.stringify(legacy), "utf8");
  sameJson(sandbox.readJsonData(configPath), legacy, "legacy plain config should load");

  const protectedConfig = { controlToken: "new-token", plugins: { twitch: { clientSecret: "new-secret" } } };
  sandbox.writeJsonData(configPath, protectedConfig);
  const rawConfig = fs.readFileSync(configPath, "utf8");
  assert(!rawConfig.includes("new-secret"), "encrypted config must not expose its secret");
  sameJson(sandbox.readJsonData(configPath), protectedConfig, "encrypted config should round-trip");

  const commands = { bedtime: { actions: [{ type: "wait", ms: 300000 }] } };
  sandbox.writeJsonData(commandsPath, commands);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(commandsPath, "utf8")), commands, "commands should stay plain JSON");
  console.log("secure storage smoke test passed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
