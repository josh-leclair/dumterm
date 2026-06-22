const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("dum", {
  storeRead: (file) => ipcRenderer.invoke("store-read", file),
  storeWrite: (file, obj) => ipcRenderer.invoke("store-write", file, obj),
  markdown: {
    list: () => ipcRenderer.invoke("md-list"),
    read: (file) => ipcRenderer.invoke("md-read", file),
    write: (file, content) => ipcRenderer.invoke("md-write", file, content),
    remove: (file) => ipcRenderer.invoke("md-remove", file),
    rename: (from, to) => ipcRenderer.invoke("md-rename", from, to),
    root: () => ipcRenderer.invoke("md-root"),
  },
  launch: (target) => ipcRenderer.invoke("launch", target),
  sendKeys: (keys) => ipcRenderer.invoke("sendkeys", keys),
  listApps: () => ipcRenderer.invoke("list-apps"),
  resolveShortcut: (p) => ipcRenderer.invoke("resolve-shortcut", p),
  httpRequest: (req) => ipcRenderer.invoke("http-request", req),
  askStream: (req) => ipcRenderer.invoke("ask-stream", req),
  onAskChunk: (cb) => ipcRenderer.on("ask-chunk", (e, msg) => cb(msg)),
  discord: (op, params) => ipcRenderer.invoke("discord-cmd", op, params),
  discordPeek: () => ipcRenderer.invoke("discord-peek"),
  onDiscordStatus: (cb) => ipcRenderer.on("discord-status", (e, msg) => cb(msg)),
  chatTools: (req) => ipcRenderer.invoke("chat-tools", req),
  lmProbe: (req) => ipcRenderer.invoke("lm-probe", req),
  listPlugins: () => ipcRenderer.invoke("list-plugins"),
  oauthToken: (cfg) => ipcRenderer.invoke("oauth-token", cfg),
  oauthClear: (service) => ipcRenderer.invoke("oauth-clear", service),
  resolveLaunch: (target) => ipcRenderer.invoke("resolve-launch", target),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard-write", text),
  clipboardRead: () => ipcRenderer.invoke("clipboard-read"),
  controlStart: (cfg) => ipcRenderer.invoke("control-start", cfg),
  onControlRequest: (cb) => ipcRenderer.on("control-request", (e, msg) => cb(msg)),
  controlRespond: (id, result) => ipcRenderer.send("control-response", { id, result }),
  onControlError: (cb) => ipcRenderer.on("control-error", (e, msg) => cb(msg)),
});
