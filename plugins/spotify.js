// Spotify plugin for dumterm.
// Controls playback on your active Spotify Connect device (the desktop/phone app
// must be open and have played something recently to count as "active").
// Runs capability-isolated: it only has `ctx`, no OS/Node access.
//
// Setup:
//   1. https://developer.spotify.com/dashboard → Create app
//   2. Redirect URI (exactly):  http://127.0.0.1:8123/callback
//   3. Copy the Client ID
//   4. In dumterm:  config spotify.clientId <id>   then   spotify connect

const PORT = 8123;
const SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-library-read",
  "user-read-private",
  "user-read-email",
];
const A = ctx.ansi;

function oauthCfg() {
  return {
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    clientId: ctx.config.get("clientId"),
    scopes: SCOPES,
    redirectPort: PORT,
    redirectPath: "/callback",
  };
}

async function token() {
  if (!ctx.config.get("clientId")) {
    throw new Error("no client id — run: config spotify.clientId <your id>");
  }
  const r = await ctx.oauth(oauthCfg());
  if (!r.ok) throw new Error(r.error);
  return r.token;
}

async function api(method, path, opts) {
  opts = opts || {};
  const t = await token();
  let url = "https://api.spotify.com" + path;
  if (opts.query) {
    url += "?" + Object.entries(opts.query)
      .map(function (kv) { return kv[0] + "=" + encodeURIComponent(kv[1]); }).join("&");
  }
  const req = { url: url, method: method, headers: { Authorization: "Bearer " + t } };
  if (opts.body) { req.headers["Content-Type"] = "application/json"; req.body = JSON.stringify(opts.body); }
  const r = await ctx.http(req);
  if (r.status === 204) return {};
  if (r.status === 404) throw new Error("no active Spotify device — open Spotify and start playing once");
  if (r.status === 403) {
    let why = "";
    try { why = JSON.parse(r.body).error.message; } catch {}
    throw new Error("Spotify refused (403)" + (why ? ": " + why : " — token may lack playback scope; try `spotify reconnect`"));
  }
  if (!r.ok) throw new Error("spotify " + r.status + ": " + String(r.body || "").slice(0, 120));
  // success: only parse when there's a real JSON body; playback commands return empty/204
  if (!r.body || !r.body.trim()) { everConnected = true; return {}; }
  const first = r.body.trim()[0];
  if (first !== "{" && first !== "[") { everConnected = true; return {}; } // non-JSON success body
  try { everConnected = true; return JSON.parse(r.body); }
  catch (e) { throw new Error("couldn't parse Spotify response (" + String(r.body).length + " chars) — likely truncated"); }
}

// Spotify's Web API only controls an ACTIVE device; if the app is open but idle there's no
// active device, so we look one up and target it explicitly (which wakes it up).
async function getDevices() {
  const d = await api("GET", "/v1/me/player/devices");
  return (d && d.devices) || [];
}
async function wakeableDeviceId() {
  const list = await getDevices();
  if (!list.length) return null;
  return (list.find(function (x) { return x.type === "Computer" && !x.is_restricted; })
    || list.find(function (x) { return !x.is_restricted; })
    || list[0]).id;
}
async function playOn(body) {
  const opts = body ? { body: body } : {};
  try {
    await api("PUT", "/v1/me/player/play", opts);
  } catch (e) {
    if (!/no active/i.test(e.message || "")) throw e;
    const did = await wakeableDeviceId();
    if (!did) throw new Error("no Spotify device found — make sure the Spotify app is open on this account");
    await api("PUT", "/v1/me/player/play", Object.assign({ query: { device_id: did } }, opts));
  }
}

// playback helpers
async function resume() { await playOn(); return "▶ playing"; }
async function pause() { await api("PUT", "/v1/me/player/pause"); return "⏸ paused"; }
async function next() { await api("POST", "/v1/me/player/next"); return "⏭ next"; }
async function prev() { await api("POST", "/v1/me/player/previous"); return "⏮ previous"; }
async function setVolume(n) {
  const v = Math.max(0, Math.min(100, parseInt(n, 10)));
  if (isNaN(v)) throw new Error("volume must be 0-100");
  await api("PUT", "/v1/me/player/volume", { query: { volume_percent: v } });
  return "🔊 " + v + "%";
}
async function nowPlaying() {
  // /v1/me/player is more reliable than /currently-playing, which 204s in many cases
  const d = await api("GET", "/v1/me/player");
  if (!d || !d.item) return "nothing playing";
  const who = (d.item.artists || []).map(function (a) { return a.name; }).join(", ");
  const album = d.item.album && d.item.album.name ? "  " + A.dim("(" + d.item.album.name + ")") : "";
  return (d.is_playing ? "▶ " : "⏸ ") + d.item.name + (who ? " — " + who : "") + album;
}

// search & play: a track plays directly; an artist/playlist/album plays as a context.
// when the type isn't forced, pick the candidate whose name best matches the query
// rather than blindly preferring tracks (which made "Section.80" play a random song).
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

async function playQuery(args) {
  let type = "track,artist,album,playlist";
  let forced = null;
  const kinds = ["track", "artist", "playlist", "album"];
  if (kinds.indexOf((args[0] || "").toLowerCase()) !== -1 && args.length > 1) {
    forced = args[0].toLowerCase();
    type = forced;
    args = args.slice(1);
  }
  const q = args.join(" ");
  if (!q) return resume();
  const nq = norm(q);

  const data = await api("GET", "/v1/search", { query: { q: q, type: type, limit: 5 } });
  const pools = {
    track: (data.tracks && data.tracks.items) || [],
    artist: (data.artists && data.artists.items) || [],
    album: (data.albums && data.albums.items) || [],
    playlist: (data.playlists && data.playlists.items) || [],
  };

  // build candidates with a match score; exact normalized name match wins big
  const cands = [];
  for (const kind of kinds) {
    if (forced && kind !== forced) continue;
    (pools[kind] || []).forEach(function (item, idx) {
      if (!item || !item.uri) return;
      const nn = norm(item.name);
      let score = 0;
      if (nn === nq) score = 100;
      else if (nn.indexOf(nq) === 0) score = 70;
      else if (nn.indexOf(nq) !== -1) score = 40;
      else if (nq.indexOf(nn) !== -1) score = 30;
      score -= idx; // light preference for higher-ranked results within a kind
      cands.push({ kind: kind, item: item, score: score });
    });
  }
  if (!cands.length) {
    const counts = kinds.map(function (k) { return k + ":" + (pools[k] ? pools[k].length : 0); }).join(" ");
    throw new Error("nothing found for '" + q + "'  " + A.dim("[" + counts + "]"));
  }
  cands.sort(function (a, b) { return b.score - a.score; });
  const best = cands[0];

  if (best.kind === "track") {
    await playOn({ uris: [best.item.uri] });
    return "▶ " + best.item.name + " — " + (best.item.artists || []).map(function (a) { return a.name; }).join(", ");
  }
  await playOn({ context_uri: best.item.uri });
  const label = best.kind + ": " + best.item.name +
    (best.item.artists ? " — " + best.item.artists.map(function (a) { return a.name; }).join(", ") : "");
  return "▶ " + label;
}

// ---------- terminal commands ----------

// shared dispatch so both `spotify <op>` and the top-level aliases hit the same code
const OPS = {
  connect: async function () { await token(); everConnected = true; refreshNP(); return A.green("✓ spotify connected"); },
  reconnect: async function () {
    await ctx.oauthReset();
    ctx.println(ctx.ansi.dim("  cleared saved token; opening browser for fresh consent…"));
    const r = await ctx.oauth({ ...oauthCfg(), forceConsent: true });
    if (!r.ok) throw new Error(r.error);
    return A.green("✓ spotify reconnected — approve ALL permissions in the browser");
  },
  now: async function () { return A.green(await nowPlaying()); },
  status: async function () { return A.green(await nowPlaying()); },
  play: async function (args) { return A.green(await playQuery(args)); },
  pause: async function () { return A.green(await pause()); },
  next: async function () { return A.green(await next()); },
  prev: async function () { return A.green(await prev()); },
  vol: async function (args) { return A.green(await setVolume(args[0])); },
  volume: async function (args) { return A.green(await setVolume(args[0])); },
  debug: async function (args) {
    const t = await token();
    const auth = { Authorization: "Bearer " + t };
    const q = args.join(" ") || "gnx";
    let r = await ctx.http({ url: "https://api.spotify.com/v1/me/player", method: "GET", headers: auth });
    ctx.println(A.dim("GET /me/player -> ") + r.status + " " + A.dim(String(r.body || "(empty)").slice(0, 100)));
    r = await ctx.http({ url: "https://api.spotify.com/v1/search?q=" + encodeURIComponent(q) + "&type=album,track,artist&limit=1", method: "GET", headers: auth });
    ctx.println(A.dim("GET /search -> ") + r.status + A.dim(" (" + String(r.body || "").length + " chars)"));
    if (!r.ok) ctx.println(A.red("  search body: ") + String(r.body || "(empty)").slice(0, 250));
    let uri = null;
    try {
      const d = JSON.parse(r.body);
      uri = (d.albums && d.albums.items[0] && d.albums.items[0].uri) ||
            (d.tracks && d.tracks.items[0] && d.tracks.items[0].uri) ||
            (d.artists && d.artists.items[0] && d.artists.items[0].uri);
    } catch (e) { ctx.println(A.red("search parse failed: " + e.message)); }
    ctx.println(A.dim("resolved uri: ") + uri);
    if (!uri) return "no uri";
    const body = uri.indexOf(":track:") !== -1 ? { uris: [uri] } : { context_uri: uri };
    r = await ctx.http({ url: "https://api.spotify.com/v1/me/player/play", method: "PUT", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    ctx.println(A.dim("PUT /play body=") + JSON.stringify(body));
    return (r.ok ? A.green : A.red)("PUT /play -> " + r.status + " " + String(r.body || "(empty body = success)").slice(0, 250));
  },
};

async function dispatch(op, args) {
  const fn = OPS[op];
  if (!fn) { ctx.println(A.dim("spotify: connect · now · play [query] · pause · next · prev · vol <0-100>")); return; }
  try { ctx.println(await fn(args)); }
  catch (e) { ctx.println(A.red("✗ " + e.message)); }
}

ctx.safeTools(["spotify_now_playing", "spotify_list_devices"]);
ctx.configHint(["clientId"]);

ctx.registerCommand("spotify", {
  description: "spotify: connect · now · play · pause · next · prev · vol",
  run: async function (args) {
    const sub = (args[0] || "now").toLowerCase();
    await dispatch(sub, args.slice(1));
  },
});

// top-level aliases for the common ops
["play", "pause", "next", "prev", "now", "vol"].forEach(function (op) {
  ctx.registerCommand(op, {
    description: "spotify " + op,
    run: async function (args) { await dispatch(op, args); },
  });
});

ctx.registerHelp([
  A.cyan("play [query]") + "       resume, or search & play a track/artist/album/playlist",
  A.cyan("play album <name>") + "  force a kind: album · artist · playlist · track",
  A.cyan("pause / next / prev") + " transport controls",
  A.cyan("vol <0-100>") + "        set volume",
  A.cyan("now") + "                what's playing",
  A.cyan("spotify connect") + "    authorize (first-time setup)",
  A.cyan("spotify reconnect") + "  re-authorize with fresh scopes",
  "",
  ctx.ansi.dim("setup: config spotify.clientId <id>, redirect http://127.0.0.1:8123/callback"),
  ctx.ansi.dim("needs Spotify open as the active device · Premium required for playback"),
]);

// ---------- macro action type ----------
// lets macros include a spotify step, e.g. a "worktime" macro that plays a playlist

ctx.registerAction("spotify", {
  describe: function (a) { return "spotify " + a.op + (a.query ? " " + a.query : ""); },
  run: async function (a) {
    if (a.op === "play") return playQuery((a.query || "").split(/\s+/).filter(Boolean));
    if (a.op === "pause") return pause();
    if (a.op === "next") return next();
    if (a.op === "prev") return prev();
    if (a.op === "vol") return setVolume(a.query);
    throw new Error("unknown spotify op: " + a.op);
  },
  agentHint: 'control Spotify. Fields: {"type":"spotify","op":"play|pause|next|prev|vol","query":"<song/artist/album name for play (e.g. baby keem); 0-100 for vol>"}. Omit query for pause/next/prev. Use this to play a specific song as a step inside a macro.',
  fromAgent: function (raw) {
    const op = String(raw.op || "").toLowerCase();
    if (["play", "pause", "next", "prev", "vol"].indexOf(op) === -1) return "error: spotify op must be play, pause, next, prev, or vol";
    const query = raw.query || raw.track || raw.song || raw.name || raw.value || "";
    if ((op === "play" || op === "vol") && !query) return "error: spotify " + op + " needs a query (a song name, or 0-100 for vol)";
    return { type: "spotify", op: op, query: String(query) };
  },
  label: "spotify",
  fields: [
    { key: "op", prompt: "operation", options: ["play", "pause", "next", "prev", "vol"] },
    { key: "query", prompt: "song/artist for play, or 0-100 for vol", optional: true },
  ],
});

// ---------- now-playing status strip ----------

let everConnected = false;
let np = { is_playing: false, name: null, artist: "", progress: 0, duration: 0, at: 0 };
let lastTrackKey = null;
let lastPlaying = null;

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function progressBar(frac, width) {
  frac = Math.max(0, Math.min(1, frac));
  const eighths = "▏▎▍▌▋▊▉█";
  const totalE = Math.round(frac * width * 8);
  const full = Math.floor(totalE / 8);
  const rem = totalE % 8;
  const partial = (rem > 0 && full < width) ? eighths[rem - 1] : "";
  const empty = "░".repeat(Math.max(0, width - full - (partial ? 1 : 0)));
  return A.green("█".repeat(full) + partial) + A.dim(empty);
}

async function refreshNP() {
  if (!everConnected) return;
  try {
    const d = await api("GET", "/v1/me/player");
    if (d && d.item) {
      const next = {
        is_playing: !!d.is_playing,
        name: d.item.name,
        artist: (d.item.artists || []).map(function (a) { return a.name; }).join(", "),
        progress: d.progress_ms || 0,
        duration: d.item.duration_ms || 0,
        at: Date.now(),
      };
      const key = String(d.item.id || "") || (next.name + "\u0000" + next.artist);
      if (key !== lastTrackKey) {
        ctx.events.emit({
          type: "spotify.track.changed",
          title: next.is_playing ? "Spotify now playing" : "Spotify queued",
          detail: next.name + (next.artist ? " - " + next.artist : ""),
          data: { track: next.name, artist: next.artist, playing: next.is_playing, durationMs: next.duration },
        });
      } else if (lastPlaying !== null && lastPlaying !== next.is_playing) {
        ctx.events.emit({
          type: next.is_playing ? "spotify.playback.resumed" : "spotify.playback.paused",
          title: next.is_playing ? "Spotify resumed" : "Spotify paused",
          detail: next.name + (next.artist ? " - " + next.artist : ""),
          data: { track: next.name, artist: next.artist },
        });
      }
      lastTrackKey = key;
      lastPlaying = next.is_playing;
      np = next;
    } else {
      if (lastTrackKey !== null) ctx.events.emit({ type: "spotify.playback.stopped", title: "Spotify stopped", detail: "" });
      lastTrackKey = null;
      lastPlaying = false;
      np = { is_playing: false, name: null, artist: "", progress: 0, duration: 0, at: 0 };
    }
  } catch (e) { /* keep last known */ }
}

function renderNPPanel() {
  if (!everConnected || !np.name) return ""; // only appears when something's loaded/playing
  let prog = np.progress + (np.is_playing ? (Date.now() - np.at) : 0);
  if (np.duration && prog > np.duration) prog = np.duration;
  const frac = np.duration ? prog / np.duration : 0;
  const glyph = np.is_playing ? "▶" : "⏸";
  const plain = np.name + (np.artist ? " — " + np.artist : "");
  const title = plain.length > 30 ? plain.slice(0, 29) + "…" : plain;
  return A.green("♪ " + glyph + " ") + A.bold(title) + "\n  " +
    A.dim(fmtTime(prog)) + " " + progressBar(frac, 12) + " " + A.dim(fmtTime(np.duration));
}

ctx.registerPanel({ corner: "top-right", render: renderNPPanel });
setInterval(refreshNP, 5000);

// structured state for the control API (uses the cached now-playing; no extra fetch)
ctx.registerState(function () {
  if (!everConnected) return { connected: false };
  let prog = np.progress + (np.is_playing ? (Date.now() - np.at) : 0);
  if (np.duration && prog > np.duration) prog = np.duration;
  return {
    connected: true,
    playing: !!np.is_playing,
    track: np.name || null,
    artist: np.artist || null,
    progressMs: prog,
    durationMs: np.duration || 0,
  };
});

ctx.registerCompletion("spotify", function () {
  return ["connect", "reconnect", "now", "play", "pause", "next", "prev", "vol"];
});
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_connect", description: "Authorize Spotify or verify the saved Spotify authorization. This may open a browser the first time.", parameters: { type: "object", properties: {} } } },
  function () { return OPS.connect([]); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_reconnect", description: "Clear the saved Spotify token and re-authorize from scratch. Use this if Spotify says permissions/scopes are missing.", parameters: { type: "object", properties: {} } } },
  function () { return OPS.reconnect([]); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_now_playing", description: "Get the current Spotify playback status and track.", parameters: { type: "object", properties: {} } } },
  async function () {
    const d = await api("GET", "/v1/me/player");
    if (!d || !d.item) return JSON.stringify({ playing: false, track: null });
    return JSON.stringify({
      playing: !!d.is_playing,
      track: d.item.name || null,
      artists: (d.item.artists || []).map(function (a) { return a.name; }),
      album: d.item.album && d.item.album.name ? d.item.album.name : null,
      progressMs: d.progress_ms || 0,
      durationMs: d.item.duration_ms || 0,
    });
  }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_list_devices", description: "List Spotify Connect devices available to play on. Use this if playback fails because there is no active device.", parameters: { type: "object", properties: {} } } },
  async function () {
    const list = await getDevices();
    return JSON.stringify(list.map(function (d) {
      return { name: d.name, type: d.type, active: !!d.is_active, restricted: !!d.is_restricted, volumePercent: d.volume_percent };
    }));
  }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_play", description: "Search Spotify and play a track/artist/album/playlist by name (e.g. 'baby keem'). Set kind when the user specifies album, artist, playlist, or track. With no query, resumes playback.", parameters: { type: "object", properties: { query: { type: "string", description: "what to play, e.g. 'baby keem'" }, kind: { type: "string", enum: ["track", "artist", "album", "playlist"], description: "optional Spotify result type to force" } } } } },
  function (a) {
    const parts = String(a.query || "").split(/\s+/).filter(Boolean);
    const kind = String(a.kind || "").toLowerCase();
    return playQuery(["track", "artist", "album", "playlist"].indexOf(kind) !== -1 ? [kind].concat(parts) : parts);
  }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_pause", description: "Pause Spotify playback.", parameters: { type: "object", properties: { confirm: { type: "boolean", description: "unused" } } } } },
  function () { return pause(); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_next", description: "Skip to the next Spotify track.", parameters: { type: "object", properties: { confirm: { type: "boolean", description: "unused" } } } } },
  function () { return next(); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_previous", description: "Go to the previous Spotify track.", parameters: { type: "object", properties: { confirm: { type: "boolean", description: "unused" } } } } },
  function () { return prev(); }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "spotify_volume", description: "Set Spotify volume 0-100.", parameters: { type: "object", properties: { percent: { type: "number" } }, required: ["percent"] } } },
  function (a) { return setVolume(a.percent); }
);
