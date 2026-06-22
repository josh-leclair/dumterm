const { app, BrowserWindow, ipcMain, globalShortcut, shell, clipboard, safeStorage } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");

let win = null;
let appListCache = null;

// Dev/testing escape hatch: set DUMTERM_DATA_DIR to run against a throwaway folder
// (config, macros, OAuth tokens, AND markdown docs all live under it). Lets you
// exercise a clean first-run without touching your real %APPDATA%/dumterm setup —
// just delete the folder to reset. Unset = the normal per-user locations.
const DEV_DATA_DIR = process.env.DUMTERM_DATA_DIR || null;
if (DEV_DATA_DIR) { try { app.setPath("userData", DEV_DATA_DIR); } catch (e) {} }

const dataDir = () => {
  const d = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
};

const STORE_FILES = new Set(["commands.json", "config.json"]);
const ENCRYPTED_DATA_MARKER = "dumterm-encrypted-v1";

function canEncryptLocalData() {
  try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function shouldEncryptDataFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name === "config.json" || name.endsWith("-tokens.json");
}

function readJsonData(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.format !== ENCRYPTED_DATA_MARKER || typeof parsed.data !== "string") return parsed;
  if (!canEncryptLocalData()) throw new Error("encrypted data is unavailable to this OS user");
  const plain = safeStorage.decryptString(Buffer.from(parsed.data, "base64"));
  return JSON.parse(plain);
}

function writeJsonData(filePath, value) {
  let output = value;
  if (shouldEncryptDataFile(filePath) && canEncryptLocalData()) {
    const encrypted = safeStorage.encryptString(JSON.stringify(value));
    output = { format: ENCRYPTED_DATA_MARKER, data: encrypted.toString("base64") };
  }
  // The Windows profile owns this directory; the restrictive mode also protects
  // files on platforms that honor POSIX permissions.
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), { encoding: "utf8", mode: 0o600 });
}

function safeStorePath(file) {
  const name = String(file || "");
  if (!STORE_FILES.has(name)) throw new Error("invalid store file");
  const base = dataDir();
  const p = path.resolve(base, name);
  if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error("invalid store path");
  return p;
}

// Markdown docs are real .md files the user can open/back up, kept in their
// Documents folder. Plugins reach this only through the constrained ctx.markdown
// capability; every name is validated to a flat *.md inside this one directory.
const MARKDOWN_DIR_NAME = "Dumterm Markdown";
function markdownDir() {
  const base = DEV_DATA_DIR || app.getPath("documents");
  const d = path.join(base, MARKDOWN_DIR_NAME);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function safeMarkdownPath(file) {
  const name = String(file || "");
  if (!/^[^\\/]+\.md$/i.test(name)) throw new Error("invalid markdown filename");
  const base = markdownDir();
  const p = path.resolve(base, name);
  if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error("invalid markdown path");
  return p;
}

function parseLaunchTarget(target) {
  const value = String(target || "").trim();
  if (!value) return { error: "empty target" };
  if (/[\r\n]/.test(value)) return { error: "target contains a newline" };
  if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) return { kind: "path", value };
  if (/^shell:AppsFolder\\/i.test(value)) return { kind: "shell-app", value };
  let url = null;
  try { url = new URL(value); } catch {}
  if (url) {
    const proto = url.protocol.toLowerCase();
    if (proto === "file:") {
      try { return { kind: "path", value: fileURLToPath(url) }; }
      catch { return { error: "bad file URL" }; }
    }
    const allowed = new Set(["http:", "https:", "mailto:", "spotify:", "steam:", "discord:", "ms-settings:"]);
    if (!allowed.has(proto)) return { error: "unsupported URL protocol: " + proto.replace(":", "") };
    return { kind: "url", value };
  }
  if (/^shell:/i.test(value)) return { kind: "shell-app", value };
  const rel = path.resolve(value);
  if (!value.includes(":") && fs.existsSync(rel)) return { kind: "path", value: rel };
  if (looksLikeWebTarget(value)) return { kind: "url", value: "https://" + value };
  if (/^[a-z0-9_.-]+$/i.test(value)) return { kind: "bare", value };
  return { kind: "path", value };
}

function looksLikeWebTarget(value) {
  if (/[\s\\]/.test(value)) return false;
  if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(value)) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/.test(value)) return true;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d+)?(?:[/?#].*)?$/i.test(value);
}

function safeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  const forbidden = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade"]);
  for (const [k, v] of Object.entries(headers)) {
    const key = String(k || "").trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key)) continue;
    if (forbidden.has(key.toLowerCase())) continue;
    const val = String(v == null ? "" : v);
    if (/[\r\n]/.test(val) || val.length > 8192) continue;
    out[key] = val;
  }
  return out;
}

function validateHttpRequest(req) {
  const urlText = String((req && req.url) || "").trim();
  let u;
  try { u = new URL(urlText); } catch { throw new Error("bad URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http/https URLs are allowed");
  const method = String((req && req.method) || "POST").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new Error("unsupported HTTP method");
  const headers = safeHeaders(req && req.headers);
  let body = req && req.body;
  if (body && typeof body !== "string") body = JSON.stringify(body);
  if (body && Buffer.byteLength(body, "utf8") > 1024 * 1024) throw new Error("request body too large");
  return { url: u.toString(), method, headers, body };
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: "#0c0e10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  // Quake-style toggle: Ctrl+` shows/hides dumterm from anywhere
  globalShortcut.register("CommandOrControl+`", () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

ipcMain.handle("clipboard-write", (e, text) => { try { clipboard.writeText(String(text || "")); return true; } catch { return false; } });
ipcMain.handle("clipboard-read", () => { try { return clipboard.readText(); } catch { return ""; } });

// ---------- storage ----------

ipcMain.handle("store-read", (e, file) => {
  try {
    const p = safeStorePath(file);
    return readJsonData(p);
  } catch {
    return null;
  }
});

ipcMain.handle("store-write", (e, file, obj) => {
  try {
    const p = safeStorePath(file);
    writeJsonData(p, obj);
    return true;
  } catch {
    return false;
  }
});

// ---------- markdown docs (real .md files in Documents/Dumterm Markdown) ----------
ipcMain.handle("md-list", () => {
  try {
    const dir = markdownDir();
    return fs.readdirSync(dir)
      .filter((f) => /\.md$/i.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { file: f, slug: f.replace(/\.md$/i, ""), modified: st.mtime.toISOString(), bytes: st.size };
      });
  } catch {
    return [];
  }
});

ipcMain.handle("md-read", (e, file) => {
  try { return { content: fs.readFileSync(safeMarkdownPath(file), "utf8") }; }
  catch { return { content: "" }; }
});

ipcMain.handle("md-write", (e, file, content) => {
  try { fs.writeFileSync(safeMarkdownPath(file), String(content == null ? "" : content), { encoding: "utf8" }); return true; }
  catch { return false; }
});

ipcMain.handle("md-remove", (e, file) => {
  try { fs.rmSync(safeMarkdownPath(file), { force: true }); return true; }
  catch { return false; }
});

ipcMain.handle("md-rename", (e, from, to) => {
  try { fs.renameSync(safeMarkdownPath(from), safeMarkdownPath(to)); return true; }
  catch { return false; }
});

ipcMain.handle("md-root", () => {
  try { return markdownDir(); }
  catch { return null; }
});

// ---------- launching things ----------
// `start` via cmd handles .exe, .lnk, URLs, and shell:AppsFolder\<AppID> (UWP) uniformly.

ipcMain.handle("launch", (e, target) => {
  return new Promise((resolve) => {
    try {
      const parsed = parseLaunchTarget(target);
      if (parsed.error) return resolve({ ok: false, error: parsed.error });
      if (parsed.kind === "url") {
        shell.openExternal(parsed.value).then(() => resolve({ ok: true })).catch((err) => resolve({ ok: false, error: String(err) }));
        return;
      }
      if (parsed.kind === "path") {
        shell.openPath(parsed.value).then((err) => resolve(err ? { ok: false, error: err } : { ok: true })).catch((err) => resolve({ ok: false, error: String(err) }));
        return;
      }
      const exe = parsed.kind === "shell-app" ? "explorer.exe" : parsed.value;
      const args = parsed.kind === "shell-app" ? [parsed.value] : [];
      const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: false });
      child.on("error", (err) => resolve({ ok: false, error: String(err) }));
      child.unref();
      setTimeout(() => resolve({ ok: true }), 150);
    } catch (err) {
      resolve({ ok: false, error: String(err) });
    }
  });
});

// ---------- keystrokes via WScript.Shell SendKeys ----------
// SendKeys syntax: ^=Ctrl +=Shift %=Alt, {F13}, {ENTER}, etc.

ipcMain.handle("sendkeys", (e, keys) => {
  return new Promise((resolve) => {
    const safe = String(keys).replace(/'/g, "''");
    const cmd = `(New-Object -ComObject WScript.Shell).SendKeys('${safe}')`;
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { timeout: 10000 },
      (err) => resolve(err ? { ok: false, error: String(err) } : { ok: true })
    );
  });
});

// ---------- installed app enumeration (Get-StartApps covers exe + UWP) ----------

ipcMain.handle("list-apps", () => {
  if (appListCache) return appListCache;
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | ConvertTo-Json -Compress"],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          let list = JSON.parse(stdout);
          if (!Array.isArray(list)) list = [list];
          appListCache = list
            .filter((a) => a && a.Name && a.AppID)
            .map((a) => ({ name: a.Name, appId: a.AppID }));
          resolve(appListCache);
        } catch {
          resolve([]);
        }
      }
    );
  });
});

// ---------- resolve dropped .lnk shortcuts ----------

ipcMain.handle("resolve-shortcut", (e, filePath) => {
  try {
    if (filePath.toLowerCase().endsWith(".lnk")) {
      const info = shell.readShortcutLink(filePath);
      return { ok: true, target: info.target || filePath, name: path.basename(filePath, ".lnk") };
    }
    return { ok: true, target: filePath, name: path.basename(filePath) };
  } catch {
    // unresolvable .lnk (e.g. UWP advertised shortcut) — launch the .lnk itself
    return { ok: true, target: filePath, name: path.basename(filePath, ".lnk") };
  }
});

// ---------- generic HTTP (webhooks) ----------

ipcMain.handle("http-request", async (e, req) => {
  try {
    const clean = validateHttpRequest(req || {});
    const opts = { method: clean.method, headers: clean.headers, signal: AbortSignal.timeout(30000) };
    if (clean.body) {
      opts.body = clean.body;
      if (!opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
    }
    const res = await fetch(clean.url, opts);
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000000) };
  } catch (err) {
    return { ok: false, status: 0, body: String((err && err.message) || err) };
  }
});

// ---------- Discord RPC over local named pipe ----------
// Protocol: frames of [opcode int32 LE][length int32 LE][JSON payload]
// op 0 = handshake, 1 = frame, 2 = close, 3 = ping, 4 = pong

const net = require("net");
const crypto = require("crypto");
const http = require("http");

const DISCORD_SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write"];

const discord = {
  socket: null,
  ready: false,
  authed: false,
  buf: Buffer.alloc(0),
  pending: new Map(), // nonce -> {resolve, reject}
};

function discordTokensPath() {
  return path.join(dataDir(), "discord-tokens.json");
}
function readDiscordTokens() {
  try { return readJsonData(discordTokensPath()); } catch { return null; }
}
function writeDiscordTokens(t) {
  writeJsonData(discordTokensPath(), t);
}
function readRendererConfig() {
  try { return readJsonData(path.join(dataDir(), "config.json")); } catch { return {}; }
}

function dcEncode(op, obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function dcReset(err) {
  if (discord.socket) { try { discord.socket.destroy(); } catch {} }
  discord.socket = null;
  discord.ready = false;
  discord.authed = false;
  discord.buf = Buffer.alloc(0);
  for (const { reject } of discord.pending.values()) reject(err || new Error("connection closed"));
  discord.pending.clear();
}

function dcConnect(clientId) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPipe = () => {
      if (attempt > 9) return reject(new Error("Discord IPC pipe not found — is Discord running?"));
      const sock = net.createConnection({ path: "\\\\.\\pipe\\discord-ipc-" + attempt });
      sock.on("error", () => { attempt++; tryPipe(); });
      sock.on("connect", () => {
        discord.socket = sock;
        sock.removeAllListeners("error");
        sock.on("error", () => dcReset(new Error("discord pipe error")));
        sock.on("close", () => dcReset());
        sock.on("data", (chunk) => {
          discord.buf = Buffer.concat([discord.buf, chunk]);
          while (discord.buf.length >= 8) {
            const len = discord.buf.readInt32LE(4);
            if (discord.buf.length < 8 + len) break;
            const payload = discord.buf.slice(8, 8 + len).toString("utf8");
            discord.buf = discord.buf.slice(8 + len);
            let msg;
            try { msg = JSON.parse(payload); } catch { continue; }
            dcHandleMessage(msg, resolve);
          }
        });
        sock.write(dcEncode(0, { v: 1, client_id: clientId }));
      });
    };
    tryPipe();
    setTimeout(() => reject(new Error("Discord handshake timed out")), 10000);
  });
}

function dcHandleMessage(msg, readyResolve) {
  if (msg.evt === "READY" && msg.cmd === "DISPATCH") {
    discord.ready = true;
    discord.selfId = msg.data?.user?.id || null;
    if (readyResolve) readyResolve();
    return;
  }
  if (msg.nonce && discord.pending.has(msg.nonce)) {
    const { resolve, reject } = discord.pending.get(msg.nonce);
    discord.pending.delete(msg.nonce);
    if (msg.evt === "ERROR") reject(new Error(msg.data?.message || "RPC error " + (msg.data?.code || "")));
    else resolve(msg.data);
  }
}

function dcRequest(cmd, args) {
  return new Promise((resolve, reject) => {
    if (!discord.socket || !discord.ready) return reject(new Error("not connected"));
    const nonce = crypto.randomUUID();
    discord.pending.set(nonce, { resolve, reject });
    discord.socket.write(dcEncode(1, { cmd, args, nonce }));
    setTimeout(() => {
      if (discord.pending.has(nonce)) {
        discord.pending.delete(nonce);
        reject(new Error(cmd + " timed out"));
      }
    }, 60000); // long: AUTHORIZE waits on you clicking the consent modal
  });
}

async function dcTokenExchange(cfg, body) {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error("token exchange failed: " + (json.error_description || json.error || res.status));
  }
  writeDiscordTokens({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 0) * 1000,
  });
  return json.access_token;
}

async function dcGetAccessToken(cfg, statusCb) {
  const saved = readDiscordTokens();
  if (saved?.access_token && saved.expires_at > Date.now() + 60000) return saved.access_token;
  if (saved?.refresh_token) {
    try {
      statusCb("refreshing token…");
      return await dcTokenExchange(cfg, {
        client_id: cfg.discordClientId,
        client_secret: cfg.discordClientSecret,
        grant_type: "refresh_token",
        refresh_token: saved.refresh_token,
      });
    } catch {} // fall through to full authorize
  }
  statusCb("check Discord — approve the popup");
  const auth = await dcRequest("AUTHORIZE", {
    client_id: cfg.discordClientId,
    scopes: DISCORD_SCOPES,
  });
  statusCb("exchanging code…");
  return await dcTokenExchange(cfg, {
    client_id: cfg.discordClientId,
    client_secret: cfg.discordClientSecret,
    grant_type: "authorization_code",
    code: auth.code,
    redirect_uri: cfg.discordRedirectUri || "http://localhost",
  });
}

async function dcEnsure(statusCb) {
  const cfg = readRendererConfig();
  // Discord is a plugin now, so its credentials live in plugins.discord.* — prefer
  // those, falling back to the legacy top-level keys so older setups keep working.
  const pl = (cfg.plugins && cfg.plugins.discord) || {};
  cfg.discordClientId = pl.clientId || pl.clientid || cfg.discordClientId;
  cfg.discordClientSecret = pl.clientSecret || pl.clientsecret || cfg.discordClientSecret;
  cfg.discordRedirectUri = pl.redirectUri || pl.redirect || cfg.discordRedirectUri;
  if (!cfg.discordClientId || !cfg.discordClientSecret) {
    throw new Error("not configured — set config discord.clientId and discord.clientSecret first");
  }
  if (!discord.socket || !discord.ready) {
    statusCb("connecting to Discord…");
    await dcConnect(cfg.discordClientId);
    discord.authed = false;
  }
  if (!discord.authed) {
    const token = await dcGetAccessToken(cfg, statusCb);
    statusCb("authenticating…");
    await dcRequest("AUTHENTICATE", { access_token: token });
    discord.authed = true;
  }
}

// read-only peek at voice state for the control API — never triggers a connect/auth
ipcMain.handle("discord-peek", async () => {
  if (!discord.socket || !discord.ready) return { connected: false };
  try {
    const v = await dcRequest("GET_VOICE_SETTINGS", {});
    return { connected: true, muted: !!v.mute, deafened: !!v.deaf };
  } catch (e) { return { connected: true }; }
});

ipcMain.handle("discord-cmd", async (e, op, params = {}) => {
  const status = (s) => {
    if (win && !win.isDestroyed()) win.webContents.send("discord-status", s);
  };
  try {
    await dcEnsure(status);
    switch (op) {
      case "connect":
        return { ok: true, result: "connected & authenticated" };
      case "mute":
        await dcRequest("SET_VOICE_SETTINGS", { mute: true });
        return { ok: true, result: "muted" };
      case "unmute":
        await dcRequest("SET_VOICE_SETTINGS", { mute: false });
        return { ok: true, result: "unmuted" };
      case "togglemute": {
        const v = await dcRequest("GET_VOICE_SETTINGS", {});
        await dcRequest("SET_VOICE_SETTINGS", { mute: !v.mute });
        return { ok: true, result: v.mute ? "unmuted" : "muted" };
      }
      case "deafen":
        await dcRequest("SET_VOICE_SETTINGS", { deaf: true });
        return { ok: true, result: "deafened" };
      case "undeafen":
        await dcRequest("SET_VOICE_SETTINGS", { deaf: false });
        return { ok: true, result: "undeafened" };
      case "toggledeafen": {
        const v = await dcRequest("GET_VOICE_SETTINGS", {});
        await dcRequest("SET_VOICE_SETTINGS", { deaf: !v.deaf });
        return { ok: true, result: v.deaf ? "undeafened" : "deafened" };
      }
      case "status": {
        const v = await dcRequest("GET_VOICE_SETTINGS", {});
        return { ok: true, result: `mic ${v.mute ? "muted" : "live"} · ${v.deaf ? "deafened" : "hearing"}` };
      }
      case "listusers": {
        const ch = await dcRequest("GET_SELECTED_VOICE_CHANNEL", {});
        if (!ch) return { ok: true, result: "not in a voice channel", users: [] };
        const users = (ch.voice_states || []).map((vs) => ({
          id: vs.user.id,
          name: vs.nick || vs.user.global_name || vs.user.username || vs.user.id,
          self: vs.user.id === discord.selfId,
          volume: typeof vs.volume === "number" ? Math.round(vs.volume) : null,
          mute: !!(vs.mute || vs.voice_state?.mute),
        }));
        return { ok: true, result: `${users.length} in #${ch.name}`, channel: ch.name, users };
      }
      case "uservolume": {
        let userId = params.userId;
        let matchedName = params.user;
        if (!userId) {
          const ch = await dcRequest("GET_SELECTED_VOICE_CHANNEL", {});
          if (!ch) return { ok: false, error: "not in a voice channel" };
          const needle = String(params.user || "").toLowerCase();
          const hit = (ch.voice_states || []).find((vs) =>
            (vs.nick || vs.user.global_name || vs.user.username || "").toLowerCase().includes(needle)
          );
          if (!hit) return { ok: false, error: "no one in channel matching '" + params.user + "'" };
          userId = hit.user.id;
          matchedName = hit.nick || hit.user.global_name || hit.user.username;
        }
        const vol = Math.max(0, Math.min(200, parseInt(params.volume, 10)));
        if (Number.isNaN(vol)) return { ok: false, error: "bad volume" };
        await dcRequest("SET_USER_VOICE_SETTINGS", { user_id: userId, volume: vol });
        return { ok: true, result: `${matchedName || userId} → ${vol}%` };
      }
      case "allvolume": {
        const ch = await dcRequest("GET_SELECTED_VOICE_CHANNEL", {});
        if (!ch) return { ok: false, error: "not in a voice channel" };
        const vol = Math.max(0, Math.min(200, parseInt(params.volume, 10)));
        if (Number.isNaN(vol)) return { ok: false, error: "bad volume" };
        let n = 0;
        for (const vs of ch.voice_states || []) {
          if (vs.user.id === discord.selfId) continue; // can't set own volume
          try {
            await dcRequest("SET_USER_VOICE_SETTINGS", { user_id: vs.user.id, volume: vol });
            n++;
          } catch {}
        }
        return { ok: true, result: `set ${n} user${n === 1 ? "" : "s"} to ${vol}% in #${ch.name}` };
      }
      default:
        return { ok: false, error: "unknown discord op: " + op };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- plugin file loading ----------

ipcMain.handle("list-plugins", () => {
  const dir = path.join(__dirname, "plugins");
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      try { out.push({ name: f.replace(/\.js$/, ""), source: fs.readFileSync(path.join(dir, f), "utf8") }); } catch {}
    }
  } catch {}
  return out;
});

// ---------- generic OAuth (Authorization Code + PKCE) capability for plugins ----------

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function svcTokensPath(service) {
  return path.join(dataDir(), service.replace(/[^a-z0-9_-]/gi, "_") + "-tokens.json");
}

async function oauthExchange(cfg, params) {
  if (cfg.clientSecret) params.client_secret = cfg.clientSecret; // confidential clients (e.g. Twitch) — sent with the secret instead of PKCE
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error("token exchange failed: " + (json.error_description || json.error || res.status));
  }
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || params.refresh_token || null,
    expires_at: Date.now() + (json.expires_in || 3600) * 1000,
    scopes: Array.isArray(cfg.scopes) ? cfg.scopes.slice().sort() : [],
  };
  writeJsonData(svcTokensPath(cfg.service), tokens);
  return tokens.access_token;
}

function oauthAuthorize(cfg) {
  return new Promise((resolve, reject) => {
    const usePkce = !cfg.clientSecret; // confidential clients (e.g. Twitch) authenticate with a secret, not PKCE
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const redirectPath = cfg.redirectPath || "/callback";
    const redirectHost = cfg.redirectHost || "127.0.0.1"; // Twitch requires literal "localhost"
    const redirectUri = `http://${redirectHost}:${cfg.redirectPort}${redirectPath}`;
    const authParams = {
      response_type: "code",
      client_id: cfg.clientId,
      scope: (cfg.scopes || []).join(" "),
      redirect_uri: redirectUri,
      state,
    };
    if (usePkce) {
      authParams.code_challenge_method = "S256";
      authParams.code_challenge = challenge;
    }
    if (cfg.forceConsent) authParams.show_dialog = "true"; // Spotify: always re-prompt so new scopes apply
    const authUrl = cfg.authUrl + "?" + new URLSearchParams(authParams).toString();

    const server = http.createServer(async (req, res) => {
      let u;
      try { u = new URL(req.url, redirectUri); } catch { res.writeHead(400); return res.end(); }
      if (!u.pathname.startsWith(redirectPath)) { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get("code");
      const gotState = u.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body style='font-family:sans-serif;background:#14161a;color:#c9cdd4;text-align:center;padding-top:80px'><h2>connected</h2><p>You can close this tab and return to dumterm.</p></body></html>");
      server.close();
      if (!code || gotState !== state) return reject(new Error("authorization failed or state mismatch"));
      try {
        const token = await oauthExchange(cfg, {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: cfg.clientId,
          ...(usePkce ? { code_verifier: verifier } : {}),
        });
        resolve(token);
      } catch (e) { reject(e); }
    });
    server.on("error", (e) =>
      reject(new Error("local callback server error: " + e.message + " (port " + cfg.redirectPort + " busy?)")));
    server.listen(cfg.redirectPort, "127.0.0.1", () => shell.openExternal(authUrl));
    setTimeout(() => { try { server.close(); } catch {}; reject(new Error("authorization timed out")); }, 180000);
  });
}

ipcMain.handle("oauth-clear", (e, service) => {
  try { fs.unlinkSync(svcTokensPath(service)); } catch {}
  return { ok: true };
});

ipcMain.handle("oauth-token", async (e, cfg) => {
  try {
    if (!cfg.clientId) return { ok: false, error: "no client id configured" };
    const requiredScopes = Array.isArray(cfg.scopes) ? cfg.scopes.slice().sort() : [];
    let saved = null;
    try { saved = readJsonData(svcTokensPath(cfg.service)); } catch {}
    const hasRequiredScopes = requiredScopes.every((scope) => Array.isArray(saved?.scopes) && saved.scopes.includes(scope));
    if (saved?.access_token && saved.expires_at > Date.now() + 60000 && hasRequiredScopes) {
      return { ok: true, token: saved.access_token };
    }
    // A refresh cannot grant a scope that the saved token never had. Fall through
    // to consent once when a shared integration needs broader access.
    if (saved?.refresh_token && hasRequiredScopes) {
      try {
        const refreshCfg = requiredScopes.length ? cfg : { ...cfg, scopes: Array.isArray(saved.scopes) ? saved.scopes : [] };
        const t = await oauthExchange(refreshCfg, {
          grant_type: "refresh_token",
          refresh_token: saved.refresh_token,
          client_id: cfg.clientId,
        });
        return { ok: true, token: t };
      } catch {} // fall through to full auth
    }
    const token = await oauthAuthorize(cfg);
    return { ok: true, token };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- LM Studio tool-calling completion (non-streamed, for the agent) ----------

ipcMain.handle("chat-tools", async (e, { url, model, messages, tools }) => {
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "local-model",
        messages,
        tools,
        tool_choice: "auto",
        stream: false,
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error?.message || "HTTP " + res.status };
    return { ok: true, message: json.choices?.[0]?.message || null };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Diagnostic: reachability + plain chat + a one-tool request, each reported separately.
ipcMain.handle("lm-probe", async (e, { url, model }) => {
  const base = url.replace(/\/$/, "");
  const out = { reachable: false, models: null, plain: null, tools: null };
  try {
    const m = await fetch(base + "/v1/models");
    out.reachable = m.ok;
    if (m.ok) {
      const j = await m.json();
      out.models = (j.data || []).map((d) => d.id);
    }
  } catch (err) {
    out.error = String(err);
    return out;
  }
  const body = (extra) => JSON.stringify({
    model: model || "local-model",
    messages: [{ role: "user", content: "Say OK." }],
    stream: false,
    ...extra,
  });
  try {
    const r = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: body({}) });
    out.plain = r.ok ? "ok" : "HTTP " + r.status + ": " + (await r.text()).slice(0, 120);
  } catch (err) { out.plain = String(err); }
  try {
    const oneTool = [{ type: "function", function: { name: "ping", description: "test", parameters: { type: "object", properties: { msg: { type: "string" } } } } }];
    const r = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: body({ tools: oneTool, tool_choice: "auto" }) });
    out.tools = r.ok ? "ok" : "HTTP " + r.status + ": " + (await r.text()).slice(0, 160);
  } catch (err) { out.tools = String(err); }
  return out;
});

// Resolve a plain app name ("chrome") to something `start` can launch, via Get-StartApps.
ipcMain.handle("resolve-launch", async (e, target) => {
  if (/^https?:\/\//i.test(target) || target.includes("\\") || target.includes("/") || target.includes(":")) {
    return target; // url or path or shell: already
  }
  const apps = appListCache || (await new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | ConvertTo-Json -Compress"],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        try {
          let list = JSON.parse(stdout);
          if (!Array.isArray(list)) list = [list];
          appListCache = list.filter((a) => a && a.Name && a.AppID).map((a) => ({ name: a.Name, appId: a.AppID }));
          resolve(appListCache);
        } catch { resolve([]); }
      });
  }));
  const needle = target.toLowerCase();
  const hit = apps.find((a) => a.name.toLowerCase() === needle)
    || apps.find((a) => a.name.toLowerCase().includes(needle));
  return hit ? "shell:AppsFolder\\" + hit.appId : target;
});

// ---------- LM Studio chat, streamed back to the renderer ----------

ipcMain.handle("ask-stream", async (e, { url, model, prompt, requestId }) => {
  const send = (type, data) => {
    if (win && !win.isDestroyed()) win.webContents.send("ask-chunk", { requestId, type, data });
  };
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "local-model",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      send("error", `HTTP ${res.status}`);
      return { ok: false };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) send("chunk", delta);
        } catch {}
      }
    }
    send("done", "");
    return { ok: true };
  } catch (err) {
    send("error", String(err));
    return { ok: false };
  }
});

// ============================================================
// local control API (Stream Deck / phone / Home Assistant → dumterm)
// localhost-only, token-gated. The renderer holds the state; main owns the socket
// and forwards each request to the renderer over IPC.
// ============================================================

let controlServer = null;
const controlPending = new Map(); // id -> resolve
const wsClients = new Set(); // live WebSocket sockets subscribed to state
let wsHeartbeat = null;

function controlSend(op, params) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new Error("window not ready"));
    const id = crypto.randomUUID();
    controlPending.set(id, resolve);
    win.webContents.send("control-request", { id, op, params });
    setTimeout(() => {
      if (controlPending.has(id)) { controlPending.delete(id); reject(new Error("renderer timeout")); }
    }, 15000);
  });
}

ipcMain.on("control-response", (e, { id, result }) => {
  const r = controlPending.get(id);
  if (r) { controlPending.delete(id); r(result); }
});

function controlReadBody(req) {
  return new Promise((resolve) => {
    if (req.method !== "POST") return resolve(null);
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : null); } catch { resolve({ _raw: data }); } });
    req.on("error", () => resolve(null));
  });
}

function controlArgs(u, body) {
  if (body && Array.isArray(body.args)) return body.args;
  const a = u.searchParams.get("args");
  return a ? a.split(/\s+/).filter(Boolean) : [];
}

// ---- minimal WebSocket (RFC6455) so plugins/Stream Deck can subscribe to live state ----
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function wsFrameText(str) {
  const data = Buffer.from(str, "utf8");
  const len = data.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  return Buffer.concat([header, data]);
}
function controlBroadcast(obj) {
  if (!wsClients.size) return;
  const frame = wsFrameText(JSON.stringify(obj));
  for (const sock of wsClients) { try { sock.write(frame); } catch {} }
}

ipcMain.handle("control-start", (e, cfg) => {
  try { startControlServer(cfg || {}); return { ok: true }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

function startControlServer(cfg) {
  if (controlServer) { try { controlServer.close(); } catch {} controlServer = null; }
  if (wsHeartbeat) { clearInterval(wsHeartbeat); wsHeartbeat = null; }
  for (const s of wsClients) { try { s.destroy(); } catch {} }
  wsClients.clear();
  if (!cfg.enabled) return;
  const token = cfg.token;
  const port = cfg.port || 9876;
  const srv = http.createServer(async (req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-Dumterm-Token, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    const json = (code, obj) => { res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, cors)); res.end(JSON.stringify(obj)); };
    // anti-DNS-rebinding: only accept localhost Host headers (this is the real protection — a rebind carries the attacker's Host)
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || "")) return json(403, { ok: false, error: "bad host" });
    // allow CORS preflight so the Stream Deck plugin / phone / HA browsers can call us; the secret token stays the real gate
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, "http://127.0.0.1");
    const reqToken = req.headers["x-dumterm-token"] || u.searchParams.get("token");
    if (!token || reqToken !== token) return json(401, { ok: false, error: "unauthorized" });
    try {
      const parts = u.pathname.split("/").map(decodeURIComponent).filter(Boolean);
      const body = await controlReadBody(req);
      let result;
      if (req.method === "POST" && parts[0] === "button" && parts[1] != null) {
        result = await controlSend("button", { n: parts[1], args: controlArgs(u, body) });
      } else if (req.method === "POST" && parts[0] === "run" && parts[1] != null) {
        result = await controlSend("run", { macro: parts[1], args: controlArgs(u, body) });
      } else if (req.method === "POST" && parts[0] === "command") {
        result = await controlSend("command", { line: (body && body.command) || parts.slice(1).join("/") });
      } else if (req.method === "GET" && parts[0] === "macros") {
        result = await controlSend("macros", {});
      } else if (req.method === "GET" && parts[0] === "buttons") {
        result = await controlSend("buttons", {});
      } else if (req.method === "GET" && parts[0] === "status") {
        result = await controlSend("status", {});
      } else if (req.method === "GET" && parts[0] === "state") {
        result = await controlSend("state", {});
      } else {
        return json(404, { ok: false, error: "not found" });
      }
      json(result && result.ok === false ? 400 : 200, result == null ? { ok: true } : result);
    } catch (err) {
      json(500, { ok: false, error: String((err && err.message) || err) });
    }
  });
  // WebSocket upgrade: ws://127.0.0.1:<port>/ws?token=<token> → live state stream
  srv.on("upgrade", (req, socket) => {
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || "")) return socket.destroy();
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/ws") return socket.destroy();
      const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((p) => p.trim()).filter(Boolean);
      const protocolToken = protocols.includes(token) ? token : null;
      const reqToken = u.searchParams.get("token") || req.headers["x-dumterm-token"] || protocolToken;
      if (!token || reqToken !== token) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
      const key = req.headers["sec-websocket-key"];
      if (!key) return socket.destroy();
      const protocolLine = protocolToken && protocols.includes("dumterm") ? "Sec-WebSocket-Protocol: dumterm\r\n" : "";
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" + protocolLine + "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n");
      wsClients.add(socket);
      socket.on("data", (buf) => { if (buf && buf.length && (buf[0] & 0x0f) === 0x8) { try { socket.write(Buffer.from([0x88, 0x00])); socket.end(); } catch {} } }); // echo a close frame, then end
      socket.on("close", () => wsClients.delete(socket));
      socket.on("error", () => { wsClients.delete(socket); try { socket.destroy(); } catch {} });
      controlSend("state", {}).then((r) => { try { socket.write(wsFrameText(JSON.stringify({ type: "state", state: (r && r.state) || {} }))); } catch {} }).catch(() => {});
    } catch (e) { try { socket.destroy(); } catch {} }
  });
  // push current state to subscribers ~1/s while any are connected (idle = zero work)
  wsHeartbeat = setInterval(async () => {
    if (!wsClients.size) return;
    try { const r = await controlSend("state", {}); controlBroadcast({ type: "state", state: (r && r.state) || {} }); } catch (e) {}
  }, 1000);
  srv.on("error", (err) => {
    if (win && !win.isDestroyed()) win.webContents.send("control-error", String((err && err.message) || err));
  });
  srv.listen(port, "127.0.0.1");
  controlServer = srv;
}
