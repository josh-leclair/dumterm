// Discord voice plugin for dumterm — mute/deafen yourself and control per-user
// volume in your current voice channel, over Discord's local RPC pipe.
//
// The privileged RPC pipe + OAuth live in the host (main.js); this plugin drives
// them through the ctx.discord capability, exactly like other integrations use
// ctx.http or ctx.markdown. So Discord is "just another plugin," not core.
//
// One-time setup (see README "Discord setup"):
//   config discord.clientId <application id>
//   config discord.clientSecret <secret>
//   discord connect            (approve the one-time popup)

const A = ctx.ansi;
const OPS = ["connect", "mute", "unmute", "togglemute", "deafen", "undeafen", "toggledeafen", "status", "users", "uservolume", "allvolume"];
const VOICE_OPS = ["mute", "unmute", "togglemute", "deafen", "undeafen", "toggledeafen", "status"];
let statusHooked = false;

ctx.safeTools(["discord_voice", "discord_list_users"]);
ctx.configHint(["clientId", "clientSecret", "redirectUri"]);

function hookStatus() {
  if (statusHooked) return;
  statusHooked = true;
  ctx.discord.onStatus((s) => ctx.notify(A.dim("· " + s), { event: false }));
}

// ---------- command ----------
ctx.registerCommand("discord", {
  description: "discord voice: mute/deafen, users, per-user volume (RPC)",
  run: async function (args) {
    const op = String(args[0] || "").toLowerCase();
    const rest = args.slice(1);
    if (!OPS.includes(op)) {
      ctx.println(A.dim("usage: discord <" + OPS.join("|") + ">"));
      ctx.println(A.dim("  e.g. discord users · discord uservolume alex 60 · discord allvolume 80"));
      if (!ctx.config.get("clientId")) ctx.println(A.dim("  setup: config discord.clientId <id> · config discord.clientSecret <secret> · discord connect"));
      return;
    }
    hookStatus();
    if (op === "users") {
      const r = await ctx.discord.cmd("listusers");
      if (!r.ok) return ctx.println(A.red("✗ " + r.error));
      if (!r.users || !r.users.length) return ctx.println(A.dim(r.result));
      ctx.println(A.green("#" + r.channel) + A.dim("  (" + r.users.length + ")"));
      for (const u of r.users) {
        const vol = u.volume == null ? "" : A.dim("  " + u.volume + "%");
        ctx.println("  " + (u.self ? A.cyan(u.name + " (you)") : u.name) + vol);
      }
      return;
    }
    let params;
    if (op === "uservolume") {
      if (rest.length < 2) return ctx.println(A.dim("usage: discord uservolume <name> <0-200>"));
      params = { user: rest.slice(0, -1).join(" "), volume: rest[rest.length - 1] };
    } else if (op === "allvolume") {
      if (!rest.length) return ctx.println(A.dim("usage: discord allvolume <0-200>"));
      params = { volume: rest[0] };
    }
    const r = await ctx.discord.cmd(op, params);
    ctx.println(r.ok ? A.green("✓ " + r.result) : A.red("✗ " + r.error));
  },
});

ctx.registerCompletion("discord", function (words) {
  return words.length <= 1 ? OPS : [];
});

ctx.registerHelp([
  A.cyan("discord connect") + "                one-time auth (after setting clientId/clientSecret)",
  A.cyan("discord mute / unmute / togglemute") + "   your mic",
  A.cyan("discord deafen / undeafen / toggledeafen"),
  A.cyan("discord status") + "                 your current mic/deafen state",
  A.cyan("discord users") + "                  who's in your voice channel + volumes",
  A.cyan("discord uservolume <name> <0-200>") + "  set one person's volume (to you)",
  A.cyan("discord allvolume <0-200>") + "      set everyone (except you)",
  "",
  A.dim("setup: config discord.clientId <id> · config discord.clientSecret <secret> · discord connect"),
  A.dim("Discord must be running; only one app can drive its voice settings at a time."),
]);

// ---------- macro action ----------
ctx.registerAction("discord", {
  label: "discord",
  describe: function (a) { return "discord " + a.op; },
  agentHint: 'control your Discord voice. {"type":"discord","op":"mute|unmute|togglemute|deafen|undeafen|toggledeafen|status"}',
  fromAgent: function (raw) {
    const op = String(raw.op || "").toLowerCase();
    if (!VOICE_OPS.includes(op)) return "error: discord op must be one of " + VOICE_OPS.join(", ");
    return { type: "discord", op: op };
  },
  fields: [{ key: "op", prompt: "operation", options: ["mute", "unmute", "togglemute", "deafen", "undeafen", "toggledeafen"] }],
  run: async function (a) {
    const r = await ctx.discord.cmd(a.op || "togglemute");
    if (!r || r.ok === false) throw new Error((r && r.error) || "discord failed");
    return r.result || ("discord " + a.op);
  },
});

// ---------- agent tools ----------
ctx.registerAgentTool(
  { type: "function", function: { name: "discord_voice", description: "Control your OWN Discord voice state.", parameters: { type: "object", properties: { op: { type: "string", enum: ["mute", "unmute", "togglemute", "deafen", "undeafen", "toggledeafen", "status"] } }, required: ["op"] } } },
  async function (a) { const r = await ctx.discord.cmd(a.op); return r.ok ? r.result : "error: " + r.error; }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "discord_list_users", description: "List everyone currently in your Discord voice channel, with their per-user volume.", parameters: { type: "object", properties: { include_volume: { type: "boolean", description: "Whether to include each user's current volume (default true)." } } } } },
  async function () {
    const r = await ctx.discord.cmd("listusers");
    if (!r.ok) return "error: " + r.error;
    return JSON.stringify({ channel: r.channel, users: (r.users || []).map((u) => ({ name: u.name, volume: u.volume, you: u.self })) });
  }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "discord_set_user_volume", description: "Set how loud ONE user is to you (0-200, 100=normal). Match the user by name.", parameters: { type: "object", properties: { user: { type: "string" }, volume: { type: "number" } }, required: ["user", "volume"] } } },
  async function (a) { const r = await ctx.discord.cmd("uservolume", { user: a.user, volume: a.volume }); return r.ok ? r.result : "error: " + r.error; }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "discord_set_all_volume", description: "Set the volume of EVERYONE in your voice channel at once (0-200, 100=normal).", parameters: { type: "object", properties: { volume: { type: "number" } }, required: ["volume"] } } },
  async function (a) { const r = await ctx.discord.cmd("allvolume", { volume: a.volume }); return r.ok ? r.result : "error: " + r.error; }
);

// ---------- structured state for the control API (no-connect peek) ----------
ctx.registerState(async function () {
  try { return await ctx.discord.peek(); } catch (e) { return { connected: false }; }
});
