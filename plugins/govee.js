// Govee plugin for dumterm — uses the v2 OpenAPI (capability model).
// Devices are addressable by name. Runs capability-isolated (only `ctx`).
//
// Setup:
//   1. Govee Home app → Profile → Settings → Apply for API Key (emailed to you)
//   2. In dumterm:  config govee.apiKey <your key>   then   govee devices

const BASE = "https://openapi.api.govee.com";
const A = ctx.ansi;

const CAP = {
  power: "devices.capabilities.on_off",
  range: "devices.capabilities.range",
  color: "devices.capabilities.color_setting",
};

let cache = null; // [{ name, sku, device, type }]

async function req(method, path, body) {
  const key = ctx.config.get("apiKey");
  if (!key) throw new Error("no API key — run: config govee.apiKey <key>");
  const r = await ctx.http({
    url: BASE + path,
    method: method,
    headers: { "Govee-API-Key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) {}
  if (!r.ok && !j.code) throw new Error("govee http " + r.status + ": " + String(r.body || "").slice(0, 80));
  // Govee wraps logical failures in a 200 with a non-200 `code`
  if (j.code && j.code !== 200) throw new Error(j.msg || j.message || ("govee code " + j.code));
  return j;
}

async function devices(force) {
  if (cache && !force) return cache;
  const j = await req("GET", "/router/api/v1/user/devices");
  cache = (j.data || []).map(function (d) {
    return { name: d.deviceName, sku: d.sku, device: d.device, type: d.type };
  });
  return cache;
}

async function find(name) {
  const list = await devices(false);
  const n = String(name || "").toLowerCase().trim();
  if (!n) throw new Error("which device? try `govee devices`");
  let hit = list.find(function (d) { return d.name.toLowerCase() === n; });
  if (!hit) hit = list.find(function (d) { return d.name.toLowerCase().indexOf(n) !== -1; });
  if (!hit) throw new Error("no device matching '" + name + "' — see `govee devices`");
  return hit;
}

async function control(dev, type, instance, value) {
  await req("POST", "/router/api/v1/device/control", {
    requestId: "dumterm-" + Date.now(),
    payload: { sku: dev.sku, device: dev.device, capability: { type: type, instance: instance, value: value } },
  });
}

// ---------- color parsing: name, #hex, or r,g,b -> Govee rgb integer ----------
const NAMED = {
  red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255],
  warm: [255, 180, 107], cool: [200, 220, 255], orange: [255, 140, 0], yellow: [255, 230, 0],
  purple: [160, 32, 240], pink: [255, 105, 180], cyan: [0, 255, 255], teal: [0, 128, 128],
  magenta: [255, 0, 255], lime: [50, 255, 50], gold: [255, 200, 0], crimson: [220, 20, 60],
};
function parseColor(s) {
  s = String(s || "").trim().toLowerCase();
  if (NAMED[s]) { const c = NAMED[s]; return c[0] * 65536 + c[1] * 256 + c[2]; }
  if (s[0] === "#" || /^[0-9a-f]{6}$/.test(s)) { return parseInt(s.replace("#", ""), 16); }
  if (s.indexOf(",") !== -1) {
    const p = s.split(",").map(function (x) { return Math.max(0, Math.min(255, parseInt(x, 10))); });
    if (p.length === 3 && p.every(function (x) { return !isNaN(x); })) return p[0] * 65536 + p[1] * 256 + p[2];
  }
  throw new Error("can't parse color '" + s + "' (try a name like blue, #1e90ff, or 30,144,255)");
}

// ---------- ops ----------
async function setPower(name, on) { const d = await find(name); await control(d, CAP.power, "powerSwitch", on ? 1 : 0); return d.name + (on ? " on" : " off"); }
async function setBrightness(name, n) {
  const d = await find(name);
  const v = Math.max(0, Math.min(100, parseInt(n, 10)));
  if (isNaN(v)) throw new Error("brightness must be 0-100");
  await control(d, CAP.range, "brightness", v);
  return d.name + " → " + v + "%";
}
async function setColor(name, color) { const d = await find(name); await control(d, CAP.color, "colorRgb", parseColor(color)); return d.name + " → " + color; }

// ---------- terminal commands ----------
async function listDevices(force) {
  const list = await devices(force);
  if (!list.length) return ctx.println(A.dim("no devices on this account"));
  ctx.println(A.green("govee devices") + A.dim("  (" + list.length + ")"));
  list.forEach(function (d) {
    ctx.println("  " + d.name + A.dim("  " + d.sku));
  });
}

ctx.safeTools(["govee_list_devices"]);
ctx.configHint(["apiKey"]);

ctx.registerCommand("govee", {
  description: "govee lights: devices · on/off · brightness · color",
  run: async function (args) {
    const op = (args[0] || "devices").toLowerCase();
    const rest = args.slice(1);
    try {
      if (op === "devices" || op === "list" || op === "ls") return listDevices(false);
      if (op === "refresh") { await devices(true); return ctx.println(A.green("✓ device list refreshed")); }
      if (op === "on") return ctx.println(A.green("✓ " + await setPower(rest.join(" "), true)));
      if (op === "off") return ctx.println(A.green("✓ " + await setPower(rest.join(" "), false)));
      if (op === "brightness" || op === "bri") { const v = rest.pop(); return ctx.println(A.green("✓ " + await setBrightness(rest.join(" "), v))); }
      if (op === "color" || op === "col") { const v = rest.pop(); return ctx.println(A.green("✓ " + await setColor(rest.join(" "), v))); }
      ctx.println(A.dim("usage: govee devices | on <name> | off <name> | brightness <name> <0-100> | color <name> <color>"));
    } catch (e) { ctx.println(A.red("✗ " + e.message)); }
  },
});

ctx.registerHelp([
  A.cyan("govee devices") + "             list your devices (addressable by name)",
  A.cyan("govee on <name>") + "           turn a device on",
  A.cyan("govee off <name>") + "          turn it off",
  A.cyan("govee brightness <name> <n>") + " set brightness 0-100 (alias: bri)",
  A.cyan("govee color <name> <color>") + "  set color: name, #hex, or r,g,b (alias: col)",
  A.cyan("govee refresh") + "             re-fetch the device list",
  "",
  A.dim("names match loosely: `govee on bedroom` hits 'Bedroom Lamp'"),
  A.dim("setup: config govee.apiKey <key>  (Govee Home app → Apply for API Key)"),
]);

// tab completion: subcommands first, then cached device names
ctx.registerCompletion("govee", function (args) {
  if (args.length <= 1) return ["devices", "on", "off", "brightness", "color", "refresh"];
  return (cache || []).map(function (d) { return d.name; });
});

// ---------- macro action ----------
ctx.registerAction("govee", {
  describe: function (a) { return "govee " + a.op + " " + a.target + (a.value ? " " + a.value : ""); },
  run: async function (a) {
    if (a.op === "on") return setPower(a.target, true);
    if (a.op === "off") return setPower(a.target, false);
    if (a.op === "brightness") return setBrightness(a.target, a.value);
    if (a.op === "color") return setColor(a.target, a.value);
    throw new Error("unknown govee op: " + a.op);
  },
  // tells the agent how to build a govee step inside a macro
  agentHint: 'control a Govee light. Fields: {"type":"govee","op":"on|off|brightness|color","target":"<exact device name>","value":"<brightness 0-100 or color>"}. value is omitted for on/off.',
  fromAgent: function (raw) {
    const op = String(raw.op || "").toLowerCase();
    const target = raw.target || raw.name;
    if (!target) return "error: govee action needs a target device name";
    if (["on", "off", "brightness", "color"].indexOf(op) === -1) return "error: govee op must be on, off, brightness, or color";
    if ((op === "brightness" || op === "color") && raw.value == null) return "error: govee " + op + " needs a value";
    return { type: "govee", op: op, target: target, value: raw.value };
  },
  // tells the manual wizard what to ask for
  label: "govee light",
  fields: [
    { key: "op", prompt: "operation", options: ["on", "off", "brightness", "color"] },
    { key: "target", prompt: "device name (exact or partial)" },
    { key: "value", prompt: "value: 0-100 for brightness, or a color (only for brightness/color)", optional: true },
  ],
});

// ---------- agent context: hand the device names to the LLM up front ----------
// so it never has to call a list tool or guess names.
ctx.registerAgentContext(async function () {
  try {
    const list = await devices(false);
    if (!list.length) return "";
    return "The user's Govee devices are named: " +
      list.map(function (d) { return '"' + d.name + '"'; }).join(", ") +
      ". When calling Govee tools, pass one of these exact device names.";
  } catch (e) { return ""; }
});

// ---------- agent tools ----------
ctx.registerAgentTool(
  { type: "function", function: { name: "govee_list_devices", description: "List the user's Govee devices with exact names. Use this before controlling lights when the target name is unclear.", parameters: { type: "object", properties: { refresh: { type: "boolean", description: "true to re-fetch from Govee instead of using the cached list" } } } } },
  async function (a) { return JSON.stringify(await devices(!!(a && a.refresh))); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "govee_set_power", description: "Turn one Govee device on or off. Pass the exact device name from the list in the system prompt (matching is also fuzzy). Do not invent names; do not list devices first.", parameters: { type: "object", properties: { name: { type: "string" }, on: { type: "boolean" } }, required: ["name", "on"] } } },
  async function (a) { return setPower(a.name, a.on); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "govee_set_brightness", description: "Set one Govee device's brightness 0-100. Use an exact device name from the system prompt list.", parameters: { type: "object", properties: { name: { type: "string" }, percent: { type: "number" } }, required: ["name", "percent"] } } },
  async function (a) { return setBrightness(a.name, a.percent); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "govee_set_color", description: "Set one Govee device's color ('blue', #hex, or 'r,g,b'). Use an exact device name from the system prompt list.", parameters: { type: "object", properties: { name: { type: "string" }, color: { type: "string" } }, required: ["name", "color"] } } },
  async function (a) { return setColor(a.name, a.color); }
);
