"use strict";

// ============================================================
// dumterm renderer
// xterm.js gives us a character grid; everything else is ours.
// ============================================================

// ---------- themes ----------

const THEMES = {
  phosphor: {
    background: "#0c0e10", foreground: "#c9cdd4", cursor: "#5dcaa5",
    selectionBackground: "#23402f",
    black: "#0c0e10", red: "#e06c6c", green: "#5dcaa5", yellow: "#f0b95a",
    blue: "#6ea8d8", magenta: "#b58cc9", cyan: "#5fc6c6", white: "#c9cdd4",
    brightBlack: "#6e7682", brightRed: "#f09595", brightGreen: "#9fe1cb",
    brightYellow: "#f5d08c", brightBlue: "#9cc4e8", brightMagenta: "#d0b0e0",
    brightCyan: "#8cdada", brightWhite: "#eef0f3",
  },
  amber: {
    background: "#100d08", foreground: "#d8c5a0", cursor: "#efb340",
    selectionBackground: "#3d2f15",
    black: "#100d08", red: "#e06c6c", green: "#b8c46a", yellow: "#efb340",
    blue: "#c49a5a", magenta: "#d8a070", cyan: "#c4b46a", white: "#d8c5a0",
    brightBlack: "#7a6c52", brightRed: "#f09595", brightGreen: "#d4dd9a",
    brightYellow: "#f5cd7c", brightBlue: "#dcc090", brightMagenta: "#e8c0a0",
    brightCyan: "#dcd49a", brightWhite: "#f0e8d8",
  },
  ice: {
    background: "#0a0e14", foreground: "#bcc8d8", cursor: "#7ab8e8",
    selectionBackground: "#1c2c40",
    black: "#0a0e14", red: "#e06c7c", green: "#7cc8a8", yellow: "#d8c078",
    blue: "#7ab8e8", magenta: "#a898d8", cyan: "#78c8d8", white: "#bcc8d8",
    brightBlack: "#5c6878", brightRed: "#f098a8", brightGreen: "#a8e0c8",
    brightYellow: "#e8d8a0", brightBlue: "#a8d0f0", brightMagenta: "#c8b8e8",
    brightCyan: "#a0e0e8", brightWhite: "#e8f0f8",
  },
  mono: {
    background: "#0d0d0d", foreground: "#cfcfcf", cursor: "#ffffff",
    selectionBackground: "#333333",
    black: "#0d0d0d", red: "#cfcfcf", green: "#ffffff", yellow: "#e8e8e8",
    blue: "#bdbdbd", magenta: "#d8d8d8", cyan: "#cfcfcf", white: "#cfcfcf",
    brightBlack: "#777777", brightRed: "#e8e8e8", brightGreen: "#ffffff",
    brightYellow: "#f5f5f5", brightBlue: "#dddddd", brightMagenta: "#eeeeee",
    brightCyan: "#e8e8e8", brightWhite: "#ffffff",
  },
  sakura: {
    background: "#171019", foreground: "#ecdce6", cursor: "#f5a8c8",
    selectionBackground: "#43243a",
    black: "#171019", red: "#f08098", green: "#ef9dc4", yellow: "#f0c990",
    blue: "#b8a8e8", magenta: "#e0a0d8", cyan: "#a8d4dc", white: "#ecdce6",
    brightBlack: "#8d7390", brightRed: "#f8a8b8", brightGreen: "#f8c0da",
    brightYellow: "#f8dcb0", brightBlue: "#d0c4f4", brightMagenta: "#f0c0e8",
    brightCyan: "#c8e8ec", brightWhite: "#faf0f6",
  },
};

// ---------- ANSI helpers ----------

const A = {
  reset: "\x1b[0m",
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bgreen: (s) => `\x1b[92m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ---------- whimsy ----------

function sparkleLine(width = 44) {
  const glyphs = ["✦", "✧", "·", "*", "⋆", "˚"];
  const colors = [A.green, A.cyan, A.yellow, A.magenta, A.dim];
  let out = "";
  for (let i = 0; i < width; i++) {
    out += Math.random() < 0.22
      ? colors[(Math.random() * colors.length) | 0](glyphs[(Math.random() * glyphs.length) | 0])
      : " ";
  }
  return out;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.13);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}

// ---------- arguments ----------
// tokenize: shell-style — quotes group words.  lights "warm white"  →  ["lights", "warm white"]

function tokenize(s) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function eventField(event, path) {
  if (!event) return undefined;
  const payload = event.payload || event.data || {};
  const root = Object.assign({ app: event.app || event.source, type: event.type, title: event.title, text: event.detail, payload: payload }, payload);
  let value = root;
  for (const key of String(path || "").split(".")) {
    if (!key || value == null || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = value[key];
  }
  if (value === null || value === undefined) return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// subst: {1} {2} … positional, {*} = everything, {1:default} = fallback value.
// Event-triggered macros also receive {event.app}, {event.type}, and any field
// placed in the event payload, such as {event.track} or {event.artist}.
function subst(str, args, event) {
  return String(str).replace(/\{event\.([a-zA-Z0-9_.-]+)(?::([^}]*))?\}/g, (m, path, def) => {
    const value = eventField(event, path);
    if (value !== undefined) return value;
    if (def !== undefined) return def;
    throw { missingArg: "{event." + path + "}" };
  }).replace(/\{(\*|\d+)(?::([^}]*))?\}/g, (m, key, def) => {
    if (key === "*") {
      if (args.length) return args.join(" ");
      if (def !== undefined) return def;
      throw { missingArg: "{*}" };
    }
    const v = args[parseInt(key, 10) - 1];
    if (v !== undefined) return v;
    if (def !== undefined) return def;
    throw { missingArg: "{" + key + "}" };
  });
}

function substAction(a, args, event) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === "when" && v && typeof v === "object") out.when = substWhen(v, args, event);
    else out[k] = typeof v === "string" ? subst(v, args, event) : v;
  }
  return out;
}

// substitute {1}/{*} inside a condition's string fields too
function substWhen(when, args, event) {
  const o = {};
  for (const [k, v] of Object.entries(when)) {
    if (k === "args" && v && typeof v === "object") {
      o.args = {};
      for (const [ak, av] of Object.entries(v)) o.args[ak] = typeof av === "string" ? subst(av, args, event) : av;
    } else {
      o[k] = typeof v === "string" ? subst(v, args, event) : v;
    }
  }
  return o;
}

// ---------- terminal setup ----------

const term = new Terminal({
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 15,
  lineHeight: 1.25,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 4000,
  theme: THEMES.phosphor,
  allowProposedApi: true,
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("term"));
fitAddon.fit();

// copy / paste handling (before keys become terminal input)
term.attachCustomKeyEventHandler((e) => {
  if (e.type !== "keydown") return true;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // Ctrl+Shift+C → always copy selection
  if (ctrl && e.shiftKey && key === "c") {
    const sel = term.getSelection();
    if (sel) window.dum.clipboardWrite(sel);
    return false;
  }
  // Ctrl+C → copy when there's a selection, otherwise let it interrupt
  if (ctrl && !e.shiftKey && key === "c") {
    const sel = term.getSelection();
    if (sel) {
      window.dum.clipboardWrite(sel);
      term.clearSelection();
      return false;
    }
    return true; // no selection → fall through to interrupt
  }
  // Ctrl+V / Ctrl+Shift+V → paste into the line editor
  // preventDefault stops xterm's *native* paste from also firing — without it, pasted text doubles
  if (ctrl && key === "v") {
    e.preventDefault();
    pasteFromClipboard();
    return false;
  }
  return true;
});

async function pasteFromClipboard() {
  if (!editor.active) return;
  let text = "";
  try { text = await window.dum.clipboardRead(); } catch {}
  if (!text) return;
  // collapse newlines so a multi-line paste doesn't submit unexpectedly
  text = text.replace(/\r?\n/g, " ");
  editor.buffer = editor.buffer.slice(0, editor.cursor) + text + editor.buffer.slice(editor.cursor);
  editor.cursor += text.length;
  redrawLine();
}

window.addEventListener("resize", () => { try { fitAddon.fit(); } catch {} });
term.focus();

function terminalText(s = "") {
  // xterm treats a bare LF as "move down in the current column". Plugin
  // commands commonly return multi-line strings, so make every embedded break
  // a real terminal newline instead of letting output stair-step sideways.
  return String(s).replace(/\r?\n/g, "\r\n");
}
function println(s = "") {
  term.write(terminalText(s) + "\r\n");
}
function print(s) {
  term.write(terminalText(s));
}

// ---------- line editor ----------
// xterm is a renderer, not a shell. This is the shell part.

const editor = {
  buffer: "",
  cursor: 0,
  history: [],
  histIdx: -1,
  savedDraft: "",
  promptStr: "",
  onSubmit: null, // (line) => void
  onTab: null, // (buffer) => string|null  (replacement) 
  active: false,
};

function promptText() {
  return editor.promptStr;
}

// visible (cell) width of a string, ignoring ANSI color codes
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// track how many rows the last render occupied, so we can clear them all
let lastRenderRows = 0;

function redrawLine() {
  const cols = term.cols || 80;
  const promptW = visibleLen(editor.promptStr);
  const endAbs = promptW + editor.buffer.length;
  const cursorAbs = promptW + editor.cursor;
  const endRow = Math.floor(Math.max(0, endAbs - (endAbs > 0 ? 1 : 0)) / cols);

  // move cursor up to the first row of the input block, then clear from there down
  let out = "";
  if (lastRenderRows > 0) out += `\x1b[${lastRenderRows}A`;
  out += "\r\x1b[J"; // column 0, erase to end of screen (all previously-wrapped rows)
  out += editor.promptStr + editor.buffer;

  // after writing, the terminal cursor sits just past the last char; reposition to editor.cursor
  const targetRow = Math.floor(cursorAbs / cols);
  const targetCol = cursorAbs % cols;
  const writtenRow = Math.floor(Math.max(0, endAbs - (endAbs > 0 ? 1 : 0)) / cols);
  const upRows = writtenRow - targetRow;
  if (upRows > 0) out += `\x1b[${upRows}A`;
  out += "\r";
  if (targetCol > 0) out += `\x1b[${targetCol}C`;

  term.write(out);
  lastRenderRows = endRow;
}

function startPrompt(promptStr, onSubmit, onTab) {
  editor.promptStr = promptStr;
  editor.onSubmit = onSubmit;
  editor.onTab = onTab || null;
  editor.buffer = "";
  editor.cursor = 0;
  editor.histIdx = -1;
  editor.active = true;
  lastRenderRows = 0;
  term.write(promptStr);
}

term.onData((data) => {
  if (textEditor.active) { handleEditorKey(data); return; }
  if (state.matrixStop) {
    state.matrixStop();
    return;
  }
  if (!editor.active) {
    // Ctrl+C while something is running
    if (data === "\x03") state.cancelRequested = true;
    return;
  }
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];

    // escape sequences (arrows, home/end, delete)
    if (ch === "\x1b") {
      const seq = data.slice(i);
      if (seq.startsWith("\x1b[A")) { historyMove(-1); i += 2; continue; }
      if (seq.startsWith("\x1b[B")) { historyMove(1); i += 2; continue; }
      if (seq.startsWith("\x1b[C")) {
        if (editor.cursor < editor.buffer.length) { editor.cursor++; term.write("\x1b[C"); }
        i += 2; continue;
      }
      if (seq.startsWith("\x1b[D")) {
        if (editor.cursor > 0) { editor.cursor--; term.write("\x1b[D"); }
        i += 2; continue;
      }
      if (seq.startsWith("\x1b[H")) { editor.cursor = 0; redrawLine(); i += 2; continue; }
      if (seq.startsWith("\x1b[F")) { editor.cursor = editor.buffer.length; redrawLine(); i += 2; continue; }
      if (seq.startsWith("\x1b[3~")) {
        if (editor.cursor < editor.buffer.length) {
          editor.buffer = editor.buffer.slice(0, editor.cursor) + editor.buffer.slice(editor.cursor + 1);
          redrawLine();
        }
        i += 3; continue;
      }
      // unknown sequence — swallow remaining
      return { ok: false, cancelled: true };
    }

    if (ch === "\r") {
      const line = editor.buffer;
      editor.active = false;
      // move cursor to the very end of the (possibly wrapped) input before newline
      const cols = term.cols || 80;
      const promptW = visibleLen(editor.promptStr);
      const cursorAbs = promptW + editor.cursor;
      const endAbs = promptW + editor.buffer.length;
      const downRows = Math.floor(endAbs / cols) - Math.floor(cursorAbs / cols);
      let mv = "";
      if (downRows > 0) mv += `\x1b[${downRows}B`;
      mv += "\r\n";
      term.write(mv);
      lastRenderRows = 0;
      if (line.trim() && state.mode === "normal") {
        if (editor.history[editor.history.length - 1] !== line) editor.history.push(line);
        if (editor.history.length > 200) editor.history.shift();
      }
      const cb = editor.onSubmit;
      editor.onSubmit = null;
      if (cb) cb(line);
      continue;
    }

    if (ch === "\x7f" || ch === "\b") {
      if (editor.cursor > 0) {
        editor.buffer = editor.buffer.slice(0, editor.cursor - 1) + editor.buffer.slice(editor.cursor);
        editor.cursor--;
        redrawLine();
      }
      continue;
    }

    if (ch === "\x03") { // Ctrl+C
      term.write("^C\r\n");
      editor.active = false;
      handleInterrupt();
      continue;
    }

    if (ch === "\t") {
      if (editor.onTab) {
        const replacement = editor.onTab(editor.buffer);
        if (replacement != null) {
          editor.buffer = replacement;
          editor.cursor = replacement.length;
          redrawLine();
        }
      }
      continue;
    }

    if (ch === "\x0c") { // Ctrl+L
      term.clear();
      redrawLine();
      continue;
    }

    // printable
    if (ch >= " ") {
      editor.buffer = editor.buffer.slice(0, editor.cursor) + ch + editor.buffer.slice(editor.cursor);
      editor.cursor++;
      redrawLine();
    }
  }
});

function historyMove(dir) {
  if (state.mode !== "normal" || editor.history.length === 0) return;
  if (editor.histIdx === -1) {
    if (dir === 1) return;
    editor.savedDraft = editor.buffer;
    editor.histIdx = editor.history.length - 1;
  } else {
    editor.histIdx += dir;
  }
  if (editor.histIdx >= editor.history.length) {
    editor.histIdx = -1;
    editor.buffer = editor.savedDraft;
  } else if (editor.histIdx < 0) {
    editor.histIdx = 0;
    return;
  } else {
    editor.buffer = editor.history[editor.histIdx];
  }
  editor.cursor = editor.buffer.length;
  redrawLine();
}

// ============================================================
// inline full-screen text editor (alt-screen modal) — ctx.editText
// ============================================================
// A small nano-style editor a plugin can open over the terminal: move the cursor,
// insert/delete, add lines, then save. Uses the alternate screen buffer so the
// prompt + scrollback are restored untouched on exit. While active it intercepts
// every keystroke (see the guard at the top of term.onData).

const textEditor = {
  active: false,
  lines: [""],
  cy: 0, cx: 0, top: 0, left: 0,
  title: "", message: "",
  dirty: false, confirmingQuit: false,
  onDone: null,
};

function editorCols() { return Math.max(20, term.cols || 80); }
function editorRows() { return Math.max(4, term.rows || 24); }

function edLine() {
  const te = textEditor;
  te.cy = Math.max(0, Math.min(te.cy, te.lines.length - 1));
  return te.lines[te.cy];
}
function edClampCx() { const te = textEditor; te.cx = Math.max(0, Math.min(te.cx, edLine().length)); }

function edInsert(s) {
  const te = textEditor; const line = edLine(); edClampCx();
  te.lines[te.cy] = line.slice(0, te.cx) + s + line.slice(te.cx);
  te.cx += s.length; te.dirty = true;
}
function edEnter() {
  const te = textEditor; const line = edLine(); edClampCx();
  te.lines.splice(te.cy, 1, line.slice(0, te.cx), line.slice(te.cx));
  te.cy++; te.cx = 0; te.dirty = true;
}
function edBackspace() {
  const te = textEditor; edClampCx();
  if (te.cx > 0) {
    const line = edLine();
    te.lines[te.cy] = line.slice(0, te.cx - 1) + line.slice(te.cx); te.cx--;
  } else if (te.cy > 0) {
    const prev = te.lines[te.cy - 1];
    te.cx = prev.length; te.lines[te.cy - 1] = prev + te.lines[te.cy];
    te.lines.splice(te.cy, 1); te.cy--;
  } else return;
  te.dirty = true;
}
function edDelete() {
  const te = textEditor; const line = edLine(); edClampCx();
  if (te.cx < line.length) te.lines[te.cy] = line.slice(0, te.cx) + line.slice(te.cx + 1);
  else if (te.cy < te.lines.length - 1) { te.lines[te.cy] = line + te.lines[te.cy + 1]; te.lines.splice(te.cy + 1, 1); }
  else return;
  te.dirty = true;
}
function edType(str) {
  const parts = String(str).replace(/\r\n?/g, "\n").split("\n");
  for (let k = 0; k < parts.length; k++) { if (k > 0) edEnter(); if (parts[k]) edInsert(parts[k]); }
}

function edPad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }

function renderEditor() {
  const te = textEditor;
  const rows = editorRows(), cols = editorCols();
  const contentRows = rows - 2;
  te.cy = Math.max(0, Math.min(te.cy, te.lines.length - 1));
  te.cx = Math.max(0, Math.min(te.cx, te.lines[te.cy].length));
  if (te.cy < te.top) te.top = te.cy;
  if (te.cy >= te.top + contentRows) te.top = te.cy - contentRows + 1;
  if (te.top < 0) te.top = 0;
  if (te.cx < te.left) te.left = te.cx;
  if (te.cx >= te.left + cols) te.left = te.cx - cols + 1;
  if (te.left < 0) te.left = 0;

  const INV = "\x1b[7m", RST = "\x1b[0m", DIM = "\x1b[2m";
  let out = "\x1b[?25l\x1b[H";
  const head = " " + (te.title || "untitled") + (te.dirty ? "  *" : "") + "   —   ^S save   ^Q quit";
  out += INV + edPad(head, cols) + RST + "\r\n";
  for (let r = 0; r < contentRows; r++) {
    const li = te.top + r;
    out += "\x1b[K";
    if (li < te.lines.length) out += te.lines[li].slice(te.left, te.left + cols);
    else out += DIM + "~" + RST;
    out += "\r\n";
  }
  const status = " Ln " + (te.cy + 1) + "/" + te.lines.length + "  Col " + (te.cx + 1) + (te.message ? "   " + te.message : "");
  out += "\x1b[K" + INV + edPad(status, cols) + RST;
  out += "\x1b[" + (2 + (te.cy - te.top)) + ";" + (1 + (te.cx - te.left)) + "H\x1b[?25h";
  term.write(out);
}

function closeEditor(result) {
  const te = textEditor;
  te.active = false;
  term.write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alt screen (restores prior screen)
  const cb = te.onDone; te.onDone = null;
  if (cb) cb(result);
}

function requestEditorQuit() {
  const te = textEditor;
  if (te.dirty && !te.confirmingQuit) {
    te.confirmingQuit = true;
    te.message = "unsaved changes — ^Q again to discard, ^S to save";
    renderEditor();
    return;
  }
  closeEditor(null);
}

function handleEditorKey(data) {
  const te = textEditor;
  data = String(data).replace(/\x1b\[20[01]~/g, ""); // strip bracketed-paste markers
  if (!data) return;
  const loneEsc = data === "\x1b";
  if (!(data[0] === "\x11" || data[0] === "\x03" || loneEsc)) te.confirmingQuit = false;
  te.message = "";

  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === "\x1b") {
      if (data === "\x1b") { requestEditorQuit(); return; }
      const seq = data.slice(i);
      if (seq.startsWith("\x1b[A")) { te.cy--; edClampCx(); i += 2; continue; }
      if (seq.startsWith("\x1b[B")) { te.cy++; edClampCx(); i += 2; continue; }
      if (seq.startsWith("\x1b[C")) { if (te.cx < edLine().length) te.cx++; else if (te.cy < te.lines.length - 1) { te.cy++; te.cx = 0; } i += 2; continue; }
      if (seq.startsWith("\x1b[D")) { if (te.cx > 0) te.cx--; else if (te.cy > 0) { te.cy--; te.cx = edLine().length; } i += 2; continue; }
      if (seq.startsWith("\x1b[H")) { te.cx = 0; i += 2; continue; }
      if (seq.startsWith("\x1b[F")) { te.cx = edLine().length; i += 2; continue; }
      if (seq.startsWith("\x1b[5~")) { te.cy -= (editorRows() - 2); edClampCx(); i += 3; continue; }
      if (seq.startsWith("\x1b[6~")) { te.cy += (editorRows() - 2); edClampCx(); i += 3; continue; }
      if (seq.startsWith("\x1b[3~")) { edDelete(); i += 3; continue; }
      const m = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(seq) || /^\x1bO[A-Za-z]/.exec(seq);
      if (m) { i += m[0].length - 1; continue; } // skip other CSI/SS3 sequences
      continue; // unknown lone escape
    }
    if (ch === "\x13") { closeEditor(te.lines.join("\n")); return; } // Ctrl+S
    if (ch === "\x11" || ch === "\x03") { requestEditorQuit(); return; } // Ctrl+Q / Ctrl+C
    if (ch === "\x16") { try { window.dum.clipboardRead().then((t) => { if (t) { edType(String(t)); renderEditor(); } }); } catch {} continue; } // Ctrl+V
    if (ch === "\r" || ch === "\n") { if (ch === "\r" && data[i + 1] === "\n") i++; edEnter(); continue; }
    if (ch === "\x7f" || ch === "\b") { edBackspace(); continue; }
    if (ch === "\t") { edInsert("  "); continue; }
    if (ch >= " ") { edInsert(ch); continue; }
  }
  renderEditor();
}

function openEditor(opts) {
  return new Promise((resolve) => {
    const te = textEditor;
    if (te.active) { resolve(null); return; }
    te.title = String((opts && opts.title) || "untitled");
    const text = (opts && opts.text != null) ? String(opts.text) : "";
    te.lines = text.split("\n");
    if (!te.lines.length) te.lines = [""];
    te.cy = 0; te.cx = 0; te.top = 0; te.left = 0;
    te.dirty = false; te.confirmingQuit = false; te.message = "";
    te.onDone = resolve;
    te.active = true;
    term.write("\x1b[?1049h"); // enter alternate screen
    renderEditor();
  });
}

window.addEventListener("resize", () => { if (textEditor.active) { try { fitAddon.fit(); } catch {} renderEditor(); } });

// ============================================================
// state, storage, action engine
// ============================================================

const state = {
  mode: "normal", // "normal" | "wizard"
  commands: {}, // name -> { description, actions: [] }
  config: { lmstudioUrl: "", lmstudioModel: "", theme: "phosphor", crt: false, agentConfirm: true },
  wizard: null,
  cancelRequested: false,
  askCounter: 0,
};

const RESERVED = new Set([
  "help", "list", "show", "create", "edit", "delete", "run", "clear",
  "theme", "crt", "config", "ask", "apps", "history", "exit", "quit", "dry",
  "timer", "at", "alarm", "timers", "cancel", "matrix", "do", "do!", "users", "open", "status", "panel",
  "button", "buttons", "bind", "unbind", "label", "api", "examples", "actions", "action", "tools", "tool", "doctor",
  "commands", "macros",
]);

// ============================================================
// plugin system (capability-isolated)
// ============================================================

const plugins = { commands: {}, actions: {}, agentTools: [], toolHandlers: {}, names: [], help: {}, agentContext: [], completions: {}, panels: [], stateProviders: [], safeTools: new Set(), configHints: {} };

// Session-only event bus. Plugins can emit structured events without coupling to
// a particular panel, while the event tracker (and future rules) can subscribe.
const eventBus = { items: [], listeners: new Set(), seq: 0 };

function emitEvent(source, raw) {
  raw = raw || {};
  const payload = Object.assign({}, raw.payload && typeof raw.payload === "object" ? raw.payload : {}, raw.data && typeof raw.data === "object" ? raw.data : {});
  const title = stripAnsi(String(raw.title || payload.title || raw.type || source || "event"));
  const detail = stripAnsi(String(raw.detail || raw.message || payload.text || ""));
  if (payload.title === undefined) payload.title = title;
  if (payload.text === undefined) payload.text = detail;
  const event = {
    id: "event-" + (++eventBus.seq),
    at: Date.now(),
    app: String(source || "core"),
    type: String(raw.type || "notice"),
    payload: payload,
    // Compatibility aliases for early consumers and a concise terminal display.
    source: String(source || "core"),
    title: title,
    detail: detail,
    level: ["info", "success", "attention", "warning", "error"].includes(raw.level) ? raw.level : "info",
    data: payload,
  };
  eventBus.items.unshift(event);
  if (eventBus.items.length > 200) eventBus.items.length = 200;
  for (const listener of eventBus.listeners) {
    try { listener(event); } catch {}
  }
  return event;
}

function listEvents(limit) {
  const count = Math.max(1, Math.min(200, Number(limit) || 50));
  return eventBus.items.slice(0, count).map((event) => Object.assign({}, event));
}

function clearEvents() {
  const count = eventBus.items.length;
  eventBus.items.length = 0;
  return count;
}

function subscribeEvents(listener, replay) {
  if (typeof listener !== "function") return function () {};
  eventBus.listeners.add(listener);
  if (replay) {
    for (const event of eventBus.items.slice().reverse()) {
      try { listener(Object.assign({}, event)); } catch {}
    }
  }
  return function () { eventBus.listeners.delete(listener); };
}

// async output helper: interject above the live prompt without eating the user's typed input
function interject(linesFn) {
  const wasActive = editor.active;
  term.write("\r\x1b[K");
  try { linesFn(); } finally { if (wasActive) redrawLine(); }
}

// plugins call ctx.notify(...) to print an out-of-band line (e.g. a streamer went live)
function pluginNotify(msg, opts) {
  opts = opts || {};
  interject(() => {
    const text = typeof msg === "string" ? msg : String(msg);
    for (const line of text.split("\n")) println(line);
  });
  if (opts.beep) beep();
  if (opts.desktop) { try { new Notification("dumterm", { body: stripAnsi(String(msg)) }); } catch {} }
}

// plugins call ctx.runMacro(name, args) to fire a saved macro from a background event
async function pluginRunMacro(cmd, args, event) {
  const key = String(cmd || "").toLowerCase();
  if (!state.commands[key]) { pluginNotify(A.red("✗ no macro: " + cmd)); return; }
  const wasActive = editor.active;
  if (wasActive) term.write("\r\x1b[K");
  await executeCommand(key, { args: args || [], event: event || null });
  if (wasActive) redrawLine();
}

// find an existing key in obj matching `k` case-insensitively, so clientId/clientid don't split into two keys
function ciKey(obj, k) {
  if (Object.prototype.hasOwnProperty.call(obj, k)) return k;
  const lk = String(k).toLowerCase();
  for (const key of Object.keys(obj)) if (key.toLowerCase() === lk) return key;
  return undefined;
}

function buildCtx(name) {
  const cfgNS = () => {
    state.config.plugins = state.config.plugins || {};
    state.config.plugins[name] = state.config.plugins[name] || {};
    return state.config.plugins[name];
  };
  const ctx = {
    name,
    print: (s) => print(s),
    println: (s) => println(s),
    ansi: A,
    http: (req) => window.dum.httpRequest(req),
    oauth: (cfg) => window.dum.oauthToken({ ...cfg, service: name }),
    oauthReset: () => window.dum.oauthClear(name),
    notify: (msg, opts) => {
      if (!opts || opts.event !== false) {
        emitEvent(name, { type: "plugin.notification", title: name, detail: msg, level: opts && opts.level });
      }
      return pluginNotify(msg, opts);
    },
    runMacro: (cmd, args, event) => pluginRunMacro(cmd, args, event),
    open: (target) => window.dum.launch(target),
    config: {
      get: (k) => { const ns = cfgNS(); const ek = ciKey(ns, k); return ek != null ? (ns[ek] ?? null) : null; },
      set: async (k, v) => { const ns = cfgNS(); ns[ciKey(ns, k) || k] = v; await saveConfig(); },
    },
    // read another plugin's config namespace and share its OAuth token (e.g. chatwatch
    // borrowing streamwatch's Twitch app). The plugin names the group, so the core
    // itself stays plugin-agnostic. Trusted-local-plugin capability, like ctx.markdown.
    shared: (group) => ({
      config: {
        get: (k) => {
          const ns = (state.config.plugins && state.config.plugins[group]) || {};
          const ek = ciKey(ns, k);
          return ek != null ? (ns[ek] ?? null) : null;
        },
      },
      oauth: (cfg) => window.dum.oauthToken({ ...cfg, service: group }),
      oauthReset: () => window.dum.oauthClear(group),
    }),
    markdown: {
      list: () => window.dum.markdown.list(),
      read: (file) => window.dum.markdown.read(file),
      write: (file, content) => window.dum.markdown.write(file, content),
      remove: (file) => window.dum.markdown.remove(file),
      rename: (from, to) => window.dum.markdown.rename(from, to),
      root: () => window.dum.markdown.root(),
    },
    // open the inline full-screen editor; resolves to the saved text, or null if cancelled
    editText: (opts) => openEditor(opts || {}),
    // privileged Discord voice RPC (the pipe + OAuth live in main.js)
    discord: {
      cmd: (op, params) => window.dum.discord(op, params),
      peek: () => window.dum.discordPeek(),
      onStatus: (cb) => window.dum.onDiscordStatus(cb),
    },
    events: {
      emit: (event) => emitEvent(name, event),
      list: (limit) => listEvents(limit),
      clear: () => clearEvents(),
      subscribe: (listener, opts) => subscribeEvents(listener, !!(opts && opts.replay)),
    },
    panels: {
      toggle: (id) => setPanelVisible(id || name, null),
      show: (id) => setPanelVisible(id || name, true),
      hide: (id) => setPanelVisible(id || name, false),
      // on-demand repaint (e.g. a live-chat panel nudging after each message);
      // id is advisory — we just re-run the render pass. Plugins throttle their calls.
      refresh: () => { try { return renderPanels(); } catch { return null; } },
    },
    registerCommand: (cmd, def) => {
      plugins.commands[cmd.toLowerCase()] = {
        description: def.description || "",
        plugin: name,
        run: async (args) => {
          try {
            const result = await def.run(args, ctx);
            if (def.emitEvent !== false) emitEvent(name, { type: "plugin.command", title: name + " command", detail: cmd + (args && args.length ? " " + args.join(" ") : ""), level: "success" });
            return result;
          } catch (err) {
            emitEvent(name, { type: "plugin.command.failed", title: name + " command failed", detail: cmd + ": " + err.message, level: "error" });
            throw err;
          }
        },
      };
    },
    registerAction: (type, def) => {
      plugins.actions[type] = {
        plugin: name,
        describe: def.describe,
        run: async (a) => {
          try {
            const result = await def.run(a, ctx);
            emitEvent(name, { type: "plugin.action", title: name + " action", detail: def.describe ? def.describe(a) : type, level: "success", data: { action: type } });
            return result;
          } catch (err) {
            emitEvent(name, { type: "plugin.action.failed", title: name + " action failed", detail: (def.describe ? def.describe(a) : type) + ": " + err.message, level: "error", data: { action: type } });
            throw err;
          }
        },
        agentHint: def.agentHint || null,   // string shown to the agent describing this action's shape
        fromAgent: def.fromAgent || null,   // (raw) => cleaned action | "error: ..."
        label: def.label || type,           // human label for the wizard menu
        fields: def.fields || null,         // [{key, prompt, options?, optional?}] for the wizard
      };
    },
    registerAgentTool: (schema, handler) => {
      plugins.agentTools.push(schema);
      plugins.toolHandlers[schema.function.name] = (a) => handler(a, ctx);
    },
    registerHelp: (lines) => {
      plugins.help[name] = Array.isArray(lines) ? lines : [String(lines)];
    },
    registerAgentContext: (fn) => {
      plugins.agentContext.push({ plugin: name, fn: fn });
    },
    registerCompletion: (command, fn) => {
      plugins.completions[command.toLowerCase()] = fn;
    },
    registerPanel: (def) => {
      plugins.panels.push({ id: String(def.id || name).toLowerCase(), plugin: name, area: def.area || "overlay", corner: def.corner || "top-right", title: def.title || name, render: def.render });
    },
    registerState: (fn) => {
      plugins.stateProviders.push({ plugin: name, fn: fn });
    },
    // sugar: bundle one operation as a macro action + agent tools that all funnel
    // into a single run(input). Decomposes into the existing register* primitives.
    registerOperation: (op) => {
      if (!op || typeof op.run !== "function") return;
      const run = op.run;
      const a = op.action;
      if (a && a.type) {
        ctx.registerAction(a.type, {
          describe: a.describe,
          agentHint: a.agentHint,
          fromAgent: a.fromAgent,
          label: a.label,
          fields: a.fields,
          run: (action) => run(a.toInput ? a.toInput(action) : action),
        });
      }
      for (const t of (op.tools || [])) {
        if (!t || !t.schema) continue;
        ctx.registerAgentTool(t.schema, async (args) => {
          try {
            const result = await run(t.toInput ? t.toInput(args) : args);
            return typeof result === "string" ? result : JSON.stringify(result);
          } catch (err) { return "error: " + err.message; }
        });
      }
    },
    // a plugin marks its read-only agent tools "safe" — they run in `do` without a confirm
    safeTools: (names) => { for (const n of (names || [])) plugins.safeTools.add(String(n)); },
    // a plugin hints its config keys so `config <plugin>.<tab>` can suggest them
    configHint: (keys) => { plugins.configHints[name] = (plugins.configHints[name] || []).concat(keys || []); },
  };
  return ctx;
}

async function loadPlugins() {
  let files = [];
  try { files = await window.dum.listPlugins(); } catch {}
  for (const f of files) {
    try {
      const ctx = buildCtx(f.name);
      // shadow privileged globals so a plugin only sees `ctx` + safe web globals; strict mode kills `this`
      const fn = new Function(
        "ctx", "window", "document", "dum", "require", "process", "globalThis",
        "module", "exports", "__dirname", "fetch", "XMLHttpRequest", "localStorage", "indexedDB",
        "Function",
        '"use strict";\n' + f.source
      );
      fn(ctx);
      plugins.names.push(f.name);
    } catch (err) {
      println(A.red("plugin '" + f.name + "' failed to load: " + err.message));
    }
  }
  if (plugins.names.length) println(A.dim("plugins loaded: ") + plugins.names.join(", "));
}

// convert the ANSI our A-helpers emit into themed HTML spans (used by the panels)
function ansiToHtml(s) {
  const th = THEMES[state.config.theme] || THEMES.phosphor;
  const map = {
    30: th.black, 31: th.red, 32: th.green, 33: th.yellow, 34: th.blue, 35: th.magenta, 36: th.cyan, 37: th.white,
    90: th.brightBlack, 91: th.brightRed, 92: th.brightGreen, 93: th.brightYellow, 94: th.brightBlue, 95: th.brightMagenta, 96: th.brightCyan, 97: th.brightWhite,
  };
  let html = "", color = null, bold = false, open = false;
  const esc = (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c);
  const openSpan = () => {
    if (open) html += "</span>";
    const st = ["color:" + (color || th.foreground)];
    if (bold) st.push("font-weight:600");
    html += '<span style="' + st.join(";") + '">';
    open = true;
  };
  openSpan();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\x1b") {
      const m = /^\x1b\[([0-9;]*)m/.exec(s.slice(i));
      if (m) {
        for (const c of m[1].split(";").map(Number)) {
          if (c === 0) { color = null; bold = false; }
          else if (c === 1) bold = true;
          else if (map[c]) color = map[c];
        }
        i += m[0].length - 1;
        openSpan();
        continue;
      }
    }
    html += esc(s[i]);
  }
  if (open) html += "</span>";
  return html;
}

// ---------- plugin panels: terminal HUDs and a dedicated right-side dock ----------
const panelEls = {}; // corner -> DOM element
const dockResize = { active: false, width: 340 };

function chatColWidth() {
  const chat = document.getElementById("plugin-chat");
  return (chat && !chat.hidden) ? chat.offsetWidth : 0;
}

function clampDockWidth(width) {
  const max = Math.max(260, Math.min(720, window.innerWidth - 360 - chatColWidth()));
  return Math.max(260, Math.min(max, Math.round(Number(width) || 340)));
}

function setDockWidth(width, persist) {
  const shell = document.getElementById("app-shell");
  if (!shell) return;
  dockResize.width = clampDockWidth(width);
  shell.style.setProperty("--dock-width", dockResize.width + "px");
  const resizer = document.getElementById("plugin-dock-resizer");
  if (resizer) resizer.setAttribute("aria-valuenow", String(dockResize.width));
  if (persist) {
    state.config.pluginDockWidth = dockResize.width;
    saveConfig();
  }
}

function installDockResizer() {
  const resizer = document.getElementById("plugin-dock-resizer");
  if (!resizer || resizer.dataset.ready) return;
  resizer.dataset.ready = "1";
  setDockWidth(state.config.pluginDockWidth || 340, false);
  resizer.addEventListener("pointerdown", (event) => {
    dockResize.active = true;
    resizer.classList.add("is-dragging");
    resizer.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resizer.addEventListener("pointermove", (event) => {
    if (!dockResize.active) return;
    // the chat column sits to the right of the dock, so discount its width from the cursor offset
    setDockWidth(window.innerWidth - event.clientX - chatColWidth(), false);
    try { fitAddon.fit(); } catch {}
  });
  const finish = (event) => {
    if (!dockResize.active) return;
    dockResize.active = false;
    resizer.classList.remove("is-dragging");
    if (event?.pointerId != null && resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    setDockWidth(dockResize.width, true);
    try { fitAddon.fit(); } catch {}
  };
  resizer.addEventListener("pointerup", finish);
  resizer.addEventListener("pointercancel", finish);
  resizer.addEventListener("dblclick", () => {
    setDockWidth(340, true);
    try { fitAddon.fit(); } catch {}
  });
}

function ensurePanelEl(corner) {
  if (panelEls[corner]) return panelEls[corner];
  const pos = {
    "top-right": "top:8px;right:8px", "top-left": "top:8px;left:8px",
    "bottom-right": "bottom:8px;right:8px", "bottom-left": "bottom:8px;left:8px",
  }[corner] || "top:8px;right:8px";
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;z-index:8;pointer-events:none;display:none;" + pos + ";" +
    'font-family:"Cascadia Mono","Cascadia Code",Consolas,monospace;font-size:13px;line-height:1.4;' +
    "padding:5px 10px;border-radius:5px;white-space:pre;max-width:42%;overflow:hidden;";
  (document.getElementById("terminal-area") || document.body).appendChild(el);
  panelEls[corner] = el;
  return el;
}

function dockCardHtml(p) {
  return '<section class="plugin-dock-panel' + (p.full ? " plugin-dock-panel--full" : "") + '">' +
    '<div class="plugin-dock-title">' + ansiToHtml(p.title) + "</div>" +
    '<div class="plugin-dock-body">' + ansiToHtml(p.content) + "</div></section>";
}

// fill one side region (the compact card dock, or the full-height chat column) with
// its cards; or clear + hide it when it has none. Returns whether it ended up visible.
function renderDockRegion(regionId, bodyId, cls, panels) {
  const region = document.getElementById(regionId);
  const body = document.getElementById(bodyId);
  const shell = document.getElementById("app-shell");
  if (!region || !body || !shell) return false;
  if (!panels.length) {
    region.hidden = true;
    shell.classList.remove(cls);
    body.innerHTML = "";
    return false;
  }
  body.innerHTML = panels.map(dockCardHtml).join("");
  region.hidden = false;
  shell.classList.add(cls);
  return true;
}

function renderPanels() {
  if (!plugins.panels.length) return;
  const th = THEMES[state.config.theme] || THEMES.phosphor;
  const hidden = state.config.hiddenPanels || [];
  const byCorner = {};
  const dockPanels = []; // compact stacked cards (area "right")
  const chatPanels = []; // own full-height column (area "right-full"), e.g. live chat
  for (const p of plugins.panels) {
    if (hidden.indexOf(p.id) !== -1 || hidden.indexOf(p.plugin) !== -1) continue; // plugin-name check preserves old status settings
    let out = null;
    try { out = p.render(); } catch {}
    if (out == null || out === "") continue;
    if (p.area === "right-full") chatPanels.push({ title: p.title, content: String(out), full: true });
    else if (String(p.area).indexOf("right") === 0) dockPanels.push({ title: p.title, content: String(out), full: false });
    else (byCorner[p.corner] = byCorner[p.corner] || []).push(String(out));
  }
  const corners = new Set([...Object.keys(panelEls), ...Object.keys(byCorner)]);
  for (const corner of corners) {
    const el = ensurePanelEl(corner);
    const content = byCorner[corner];
    if (!content || !content.length) { el.style.display = "none"; continue; }
    el.style.background = th.background + "e6"; // ~90% opaque over the terminal
    el.style.border = "1px solid " + th.brightBlack;
    el.style.color = th.foreground;
    el.innerHTML = ansiToHtml(content.join("\n"));
    el.style.display = "block";
  }
  const shell = document.getElementById("app-shell");
  if (shell) {
    // the compact dock and the chat column are SEPARATE regions, so a full-height
    // chat panel gets its own space and never replaces the live/activity/rules cards
    const hasDock = renderDockRegion("plugin-dock", "plugin-dock-panels", "has-dock", dockPanels);
    renderDockRegion("plugin-chat", "plugin-chat-panels", "has-chat", chatPanels);
    const resizer = document.getElementById("plugin-dock-resizer");
    if (resizer) resizer.hidden = !hasDock;
    if (hasDock) setDockWidth(state.config.pluginDockWidth || dockResize.width, false);
    // full-height panels (e.g. live twitch chat) own their own scroll — pin to the newest line
    try { shell.querySelectorAll(".plugin-dock-panel--full .plugin-dock-body").forEach((b) => { b.scrollTop = b.scrollHeight; }); } catch {}
    requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
  }
  return { ok: true };
}

function startPanels() {
  if (!plugins.panels.length) return;
  renderPanels();
  setInterval(() => { try { renderPanels(); } catch {} }, 1000);
}

// `status` manages plugin panels: list them, or show/hide individual ones (persisted)
function cmdStatus(args) {
  args = args || [];
  state.config.hiddenPanels = state.config.hiddenPanels || [];
  const names = [...new Set(plugins.panels.map((p) => p.plugin))];
  if (!names.length) return println(A.dim("no plugin panels registered yet"));
  const sub = (args[0] || "").toLowerCase();
  if (!sub) {
    println(A.dim("plugin panels:"));
    for (const n of names) {
      const isHidden = state.config.hiddenPanels.indexOf(n) !== -1;
      const panel = plugins.panels.find((p) => p.plugin === n) || {};
      const location = panel.area === "right-full" ? "chat column" : String(panel.area).indexOf("right") === 0 ? "right dock" : (panel.corner || "top-right");
      println("  " + (isHidden ? A.dim("○ " + n) : A.green("● " + n)) + A.dim("   " + location + (isHidden ? "  (hidden)" : "")));
    }
    println(A.dim("  toggle: status <name> · status <name> on|off · status all on|off"));
    return;
  }
  const explicit = (args[1] || "").toLowerCase();
  const setHidden = explicit === "off" ? true : explicit === "on" ? false : null; // null = toggle
  let targets;
  if (sub === "all") targets = names;
  else {
    const match = names.find((n) => n === sub) || names.find((n) => n.indexOf(sub) === 0);
    if (!match) return println(A.red("no overlay named '" + sub + "'") + A.dim("  (" + names.join(", ") + ")"));
    targets = [match];
  }
  for (const n of targets) {
    const isHidden = state.config.hiddenPanels.indexOf(n) !== -1;
    const hide = setHidden == null ? !isHidden : setHidden;
    if (hide && !isHidden) state.config.hiddenPanels.push(n);
    else if (!hide && isHidden) state.config.hiddenPanels = state.config.hiddenPanels.filter((x) => x !== n);
  }
  saveConfig();
  renderPanels();
  const nowHidden = targets.filter((n) => state.config.hiddenPanels.indexOf(n) !== -1);
  println(A.dim(targets.join(", ") + " → " + (nowHidden.length === targets.length ? "hidden" : "shown")));
}

function panelEntries() {
  const seen = new Set();
  return plugins.panels.filter((panel) => {
    if (seen.has(panel.id)) return false;
    seen.add(panel.id);
    return true;
  });
}

function resolvePanelId(ref) {
  const key = String(ref || "").toLowerCase();
  const entries = panelEntries();
  const match = entries.find((panel) => panel.id === key)
    || entries.find((panel) => panel.id.indexOf(key) === 0);
  return match ? match.id : null;
}

async function setPanelVisible(ref, visible) {
  state.config.hiddenPanels = state.config.hiddenPanels || [];
  const id = resolvePanelId(ref);
  if (!id) throw new Error("no panel named '" + ref + "'");
  const panel = panelEntries().find((entry) => entry.id === id);
  const isHidden = state.config.hiddenPanels.indexOf(id) !== -1 || state.config.hiddenPanels.indexOf(panel.plugin) !== -1;
  const hide = visible == null ? !isHidden : !visible;
  if (hide && !isHidden) state.config.hiddenPanels.push(id);
  else if (!hide && isHidden) state.config.hiddenPanels = state.config.hiddenPanels.filter((value) => value !== id && value !== panel.plugin);
  await saveConfig();
  renderPanels();
  return { id, visible: !hide };
}

async function cmdPanel(args) {
  args = args || [];
  const entries = panelEntries();
  if (!entries.length) return println(A.dim("no plugin panels registered yet"));
  const ref = String(args[0] || "").toLowerCase();
  if (!ref) {
    println(A.dim("registered panels:"));
    for (const panel of entries) {
      const hidden = (state.config.hiddenPanels || []).indexOf(panel.id) !== -1 || (state.config.hiddenPanels || []).indexOf(panel.plugin) !== -1;
      const location = panel.area === "right-full" ? "chat column" : String(panel.area).indexOf("right") === 0 ? "right dock" : (panel.corner || "top-right");
      println("  " + (hidden ? A.dim("off " + panel.id) : A.green("on  " + panel.id)) + A.dim("  " + location));
    }
    return println(A.dim("  toggle: panel <name> · panel <name> on|off · panel all on|off"));
  }
  const explicit = String(args[1] || "").toLowerCase();
  const visible = explicit === "on" ? true : explicit === "off" ? false : null;
  const targets = ref === "all" ? entries.map((panel) => panel.id) : [resolvePanelId(ref)];
  if (targets.some((id) => !id)) return println(A.red("no panel named '" + ref + "'") + A.dim("  (" + entries.map((panel) => panel.id).join(", ") + ")"));
  const results = [];
  for (const id of targets) results.push(await setPanelVisible(id, visible));
  println(A.dim(results.map((result) => result.id).join(", ") + " → " + (results.every((result) => result.visible) ? "shown" : "hidden")));
}

async function loadStore() {
  const cmds = await window.dum.storeRead("commands.json");
  if (cmds) state.commands = cmds;
  const cfg = await window.dum.storeRead("config.json");
  if (cfg) Object.assign(state.config, cfg);
  if (THEMES[state.config.theme]) term.options.theme = THEMES[state.config.theme];
  document.body.classList.toggle("crt", !!state.config.crt);
}

function saveCommands() {
  return window.dum.storeWrite("commands.json", state.commands);
}
function saveConfig() {
  return window.dum.storeWrite("config.json", state.config);
}

// ---------- action descriptions ----------

function describeAction(a) {
  const base = describeActionBase(a);
  return a.when ? base + A.dim("  ⟨if " + describeWhen(a.when) + "⟩") : base;
}

function describeActionBase(a) {
  switch (a.type) {
    case "open": return `open    ${a.label ? a.label + "  " + A.dim(a.target) : a.target}`;
    case "key": return `key     ${a.keys}`;
    case "webhook": return `webhook ${(a.method || "POST")} ${a.url}` + (a.body ? A.dim("  body:" + truncate(a.body, 40)) : "");
    case "command": return `command ${a.name}`;
    case "wait": return `wait    ${a.ms}ms`;
    case "timer": return `timer   after ${a.after}` + (a.run ? ` → ${a.run}` : "");
    case "check": return `check   ${a.tool}` + (a.path ? A.dim("." + a.path) : "");
    default:
      if (plugins.actions[a.type] && plugins.actions[a.type].describe) {
        try { return plugins.actions[a.type].describe(a); } catch {}
      }
      return JSON.stringify(a);
  }
  return { ok: true };
}

function macroActionCatalog() {
  const builtins = [
    { type: "open", source: "core", fields: "target, label?", example: { type: "open", target: "chrome" } },
    { type: "key", source: "core", fields: "keys", example: { type: "key", keys: "^+{F13}" } },
    { type: "webhook", source: "core", fields: "url, method?, body?", example: { type: "webhook", url: "https://example/webhook", method: "POST" } },
    { type: "command", source: "core", fields: "name", example: { type: "command", name: "winddown" } },
    { type: "wait", source: "core", fields: "ms", example: { type: "wait", ms: 300000 }, note: "non-blocking; resumes the remaining macro later and shows in the timer overlay" },
    { type: "timer", source: "core", fields: "after, run?", example: { type: "timer", after: "5m", run: "lights_off" }, note: "non-blocking countdown; shows in the timer overlay" },
    { type: "check", source: "core", fields: "tool, args?", example: { type: "check", tool: "twitch_is_live", args: { streamer: "ninja" } } },
  ];
  const plug = Object.entries(plugins.actions).map(([type, def]) => ({
    type,
    source: def.plugin || "plugin",
    fields: def.agentHint || (def.fields ? def.fields.map((f) => f.key + (f.optional ? "?" : "")).join(", ") : ""),
    label: def.label || type,
  }));
  return builtins.concat(plug);
}

function agentToolNames() {
  const names = new Set();
  for (const t of AGENT_TOOLS.concat(plugins.agentTools)) {
    if (t.function && t.function.name) names.add(t.function.name);
  }
  return names;
}

function inspectWhen(when, where, issues, warnings) {
  if (!when) return;
  if (typeof when !== "object") {
    issues.push(where + ": condition is not an object");
    return;
  }
  const hasSource = when.arg != null || when.tool || when.get;
  if (!hasSource) {
    issues.push(where + ": condition needs arg, tool, or get");
    return;
  }
  const ops = ["eq", "ne", "contains", "not_contains", "matches", "gt", "lt", "exists", "truthy", "falsy", "not", "status"];
  if (when.op && !ops.includes(when.op)) issues.push(where + ": unknown condition op '" + when.op + "'");
  if (when.tool && !agentToolNames().has(when.tool)) warnings.push(where + ": condition uses unknown tool '" + when.tool + "'");
}

function inspectAction(a, idx, issues, warnings) {
  const where = "step " + idx;
  if (!a || typeof a !== "object") {
    issues.push(where + ": action is not an object");
    return;
  }
  if (!a.type) {
    issues.push(where + ": missing type");
    return;
  }
  switch (a.type) {
    case "open":
      if (!a.target) issues.push(where + ": open needs target");
      break;
    case "key":
      if (!a.keys) issues.push(where + ": key needs keys");
      break;
    case "webhook":
      if (!a.url) issues.push(where + ": webhook needs url");
      break;
    case "command":
      if (!a.name) issues.push(where + ": command needs name");
      else if (!state.commands[String(a.name).toLowerCase()]) issues.push(where + ": chained macro '" + a.name + "' does not exist");
      break;
    case "wait": {
      const ms = parseInt(a.ms, 10);
      if (isNaN(ms) || ms < 0) issues.push(where + ": wait needs non-negative ms");
      break;
    }
    case "timer":
      if (!a.after || parseDuration(String(a.after)) == null) issues.push(where + ": timer needs after like 5m");
      if (a.run && !state.commands[String(a.run).toLowerCase()]) issues.push(where + ": timer target macro '" + a.run + "' does not exist");
      break;
    case "check":
      if (!a.tool) issues.push(where + ": check needs tool");
      else if (!agentToolNames().has(a.tool)) warnings.push(where + ": check uses unknown tool '" + a.tool + "'");
      break;
    default:
      if (!plugins.actions[a.type]) issues.push(where + ": unknown action type '" + a.type + "'");
      break;
  }
  inspectWhen(a.when, where, issues, warnings);
}

function inspectMacro(name) {
  const key = String(name || "").toLowerCase();
  const c = state.commands[key];
  if (!c) return { ok: false, error: "no macro named '" + name + "'" };
  const issues = [];
  const warnings = [];
  (c.actions || []).forEach((a, i) => inspectAction(a, i + 1, issues, warnings));
  if (!Array.isArray(c.actions) || !c.actions.length) issues.push("macro has no actions");
  return { ok: issues.length === 0, name: key, actions: (c.actions || []).length, issues, warnings };
}

function macroDiagnosisSummary(name) {
  const r = inspectMacro(name);
  if (r.error) return "diagnosis unavailable: " + r.error;
  if (r.ok && !r.warnings.length) return "diagnosis ok";
  const parts = [];
  if (r.issues.length) parts.push("issues: " + r.issues.join("; "));
  if (r.warnings.length) parts.push("warnings: " + r.warnings.join("; "));
  return parts.join(" | ");
}

function toolError(name, message) {
  let hint = "";
  if (["create_macro", "add_macro_action", "validate_macro_actions"].includes(name)) {
    hint = " Hint: call list_action_types if the action type is unclear, and validate_macro_actions with a flat action array. Put condition checks inside action.when.";
  } else if (["run_macro", "get_macro", "delete_macro", "diagnose_macro"].includes(name)) {
    hint = " Hint: call list_macros to find the exact macro name.";
  }
  return "error: " + message + hint;
}

// ---------- conditions (per-action `when` guards) ----------

function describeWhen(when) {
  if (!when || typeof when !== "object") return "";
  const op = when.op || "truthy";
  const val = when.value !== undefined ? " " + when.value : "";
  if (when.arg != null) return `arg ${when.arg} ${op}${val}`;
  if (when.tool) return `${when.tool}${when.path ? "." + when.path : ""} ${op}${val}`;
  if (when.get) return `GET ${truncate(when.get, 30)} ${op}${val}`;
  return JSON.stringify(when);
}

function extractPath(raw, path) {
  let obj = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return raw; } }
  for (const k of String(path).split(".")) {
    if (obj == null) return undefined;
    obj = obj[k];
  }
  return obj;
}

function compareOp(actual, op, value) {
  const s = (x) => String(x == null ? "" : x);
  switch (op) {
    case "eq": return s(actual).toLowerCase() === s(value).toLowerCase();
    case "ne": return s(actual).toLowerCase() !== s(value).toLowerCase();
    case "contains": return s(actual).toLowerCase().includes(s(value).toLowerCase());
    case "not_contains": return !s(actual).toLowerCase().includes(s(value).toLowerCase());
    case "matches": { try { return new RegExp(value, "i").test(s(actual)); } catch { return false; } }
    case "gt": return parseFloat(actual) > parseFloat(value);
    case "lt": return parseFloat(actual) < parseFloat(value);
    case "exists": return actual != null && s(actual) !== "";
    case "status": return s(actual) === s(value);
    case "falsy": case "not": return !(!!actual && s(actual) !== "false" && s(actual) !== "0");
    case "truthy":
    default: return !!actual && s(actual) !== "false" && s(actual) !== "0";
  }
}

// evaluate a condition → boolean. A failed check counts as false (skip the guarded step).
function stableWhenValue(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableWhenValue).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableWhenValue(value[key])).join(",") + "}";
}

function whenCacheKey(when) {
  if (when.tool) return "tool:" + when.tool + ":" + stableWhenValue(when.args || {});
  if (when.get) return "get:" + String(when.method || "GET").toUpperCase() + ":" + when.get;
  return null;
}

async function evalWhen(when, args, cache) {
  if (!when || typeof when !== "object") return true;
  let actual;
  try {
    if (when.arg != null) {
      actual = (args || [])[parseInt(when.arg, 10) - 1];
    } else if (when.tool) {
      const key = whenCacheKey(when);
      if (key && cache && cache.has(key)) actual = await cache.get(key);
      else {
        const result = execTool(when.tool, when.args || {});
        if (key && cache) cache.set(key, result);
        actual = await result;
      }
      if (when.path) actual = extractPath(actual, when.path);
    } else if (when.get) {
      const key = whenCacheKey(when);
      let r;
      if (key && cache && cache.has(key)) r = await cache.get(key);
      else {
        const result = window.dum.httpRequest({ url: when.get, method: when.method || "GET" });
        if (key && cache) cache.set(key, result);
        r = await result;
      }
      actual = when.op === "status" ? String(r.status) : r.body;
      if (when.path && when.op !== "status") actual = extractPath(actual, when.path);
    } else {
      return true;
    }
  } catch {
    return false;
  }
  return compareOp(actual, when.op || "truthy", when.value);
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------- action engine ----------

async function executeCommand(name, opts = {}) {
  const depth = opts.depth || 0;
  const dry = !!opts.dry;
  const args = opts.args || [];
  const actionOffset = opts.actionOffset || 0;
  const totalActions = opts.totalActions || 0;
  // One macro pass may have adjacent IF/ELSE actions guarded by the same external
  // check. Cache that result just for this pass so the branch is consistent and cheap.
  const conditionCache = opts.conditionCache || new Map();
  if (depth > 8) {
    println(A.red("  ✗ chain too deep (loop?) — stopped at " + name));
    return { ok: false, error: "chain too deep" };
  }
  const cmd = state.commands[name];
  if (!cmd) {
    println(A.red(`  ✗ no such command: ${name}`));
    return { ok: false, error: "no such command: " + name };
  }
  if (!dry && depth === 0 && actionOffset === 0) {
    emitEvent("core", { type: "macro.started", title: "Macro started", detail: name, data: { macro: name, args: args } });
  }
  // substitute everything up front — if an argument is missing, nothing fires
  let actions;
  if (opts.actions) {
    actions = opts.actions;
  } else try {
    actions = cmd.actions.map((a) => substAction(a, args, opts.event));
  } catch (e) {
    if (e.missingArg) {
      println(A.red(`  ✗ missing argument ${e.missingArg}`) + A.dim(` — '${name}' needs it, e.g. ${name} <value>`));
      return { ok: false, error: "missing argument " + e.missingArg };
    }
    throw e;
  }
  const shownTotal = totalActions || actions.length;
  state.cancelRequested = false;
  for (let i = 0; i < actions.length; i++) {
    if (state.cancelRequested) {
      println(A.yellow("  ⊘ cancelled"));
      if (!dry && depth === 0) emitEvent("core", { type: "macro.cancelled", title: "Macro cancelled", detail: name, level: "warning", data: { macro: name } });
      return;
    }
    const a = actions[i];
    const tag = A.dim(`  [${actionOffset + i + 1}/${shownTotal}]`);
    const condPass = a.when ? await evalWhen(a.when, args, conditionCache) : true;
    if (dry) {
      const cond = a.when ? A.dim("if " + describeWhen(a.when) + " → ") + (condPass ? A.green("run") : A.yellow("skip")) + " " : "";
      println(`${tag} ${A.dim("would")} ${cond}${describeActionBase(a)}`);
      continue;
    }
    if (a.when && !condPass) {
      println(`${tag} ${A.yellow("⊘ skipped")} ${A.dim("— " + describeWhen(a.when))}`);
      continue;
    }
    switch (a.type) {
      case "open": {
        print(`${tag} open ${a.label || a.target} `);
        const r = await window.dum.launch(a.target);
        println(r.ok ? A.green("✓") : A.red("✗ " + (r.error || "")));
        break;
      }
      case "key": {
        print(`${tag} keys ${a.keys} `);
        const r = await window.dum.sendKeys(a.keys);
        println(r.ok ? A.green("✓") : A.red("✗ " + (r.error || "")));
        break;
      }
      case "webhook": {
        print(`${tag} ${a.method || "POST"} ${a.url} `);
        const r = await window.dum.httpRequest({ url: a.url, method: a.method, body: a.body });
        println(r.ok ? A.green(`✓ ${r.status}`) : A.red(`✗ ${r.status || ""} ${truncate(r.body, 60)}`));
        break;
      }
      case "command": {
        println(`${tag} → ${a.name}`);
        const r = await executeCommand(a.name, { depth: depth + 1, dry, args, event: opts.event });
        if (r && r.deferred) return r;
        break;
      }
      case "wait": {
        const ms = parseInt(a.ms, 10) || 0;
        if (ms > 0) {
          const rest = actions.slice(i + 1);
          const resumeAt = actionOffset + i + 1;
          const tid = scheduleTimer(Date.now() + ms, null, [], `resume '${name}'`, {
            kind: "wait",
            silent: true,
            overlay: true,
            onFire: async function () {
              if (rest.length) await executeCommand(name, { depth, dry, args, event: opts.event, actions: rest, totalActions: shownTotal, actionOffset: resumeAt });
            },
          });
          println(`${tag} wait #${tid} ` + A.green("ok") + A.dim(" continuing in " + fmtRemaining(ms) + " (terminal stays free)"));
          if (depth === 0) emitEvent("core", { type: "macro.deferred", title: "Macro waiting", detail: name + " resumes in " + fmtRemaining(ms), data: { macro: name, timer: tid } });
          return { ok: true, deferred: true, timer: tid };
        }
        print(`${tag} wait ${ms}ms `);
        await new Promise((res) => setTimeout(res, ms));
        println(A.green("✓"));
        break;
      }
      case "timer": {
        const tms = parseDuration(String(a.after || a.duration || ""));
        if (tms == null || tms <= 0) { println(`${tag} ${A.red("✗ bad timer duration: " + (a.after || a.duration))}`); break; }
        const tmacro = a.run ? String(a.run).toLowerCase() : null;
        if (tmacro && !state.commands[tmacro]) { println(`${tag} ${A.red("✗ no macro to run: " + tmacro)}`); break; }
        const tid = scheduleTimer(Date.now() + tms, tmacro, [], tmacro ? `timer → ${tmacro}` : "timer done", { kind: "timer", overlay: true });
        println(`${tag} timer #${tid} ` + A.green("✓") + A.dim(" fires in " + fmtRemaining(tms) + (tmacro ? " → " + tmacro : "")));
        break;
      }
      case "check": {
        print(`${tag} check ${a.tool} `);
        const r = await execTool(a.tool, a.args || {});
        println(A.green("ok") + A.dim(" " + truncate(String(r), 80)));
        break;
      }
      default:
        if (plugins.actions[a.type]) {
          print(`${tag} ${a.type} `);
          try {
            const r = await plugins.actions[a.type].run(a);
            println(A.green("✓") + (r ? A.dim(" " + truncate(r, 60)) : ""));
          } catch (err) {
            println(A.red("✗ " + err.message));
          }
        } else {
          println(`${tag} ${A.red("unknown action type: " + a.type)}`);
        }
    }
  }
  if (!dry && depth === 0) emitEvent("core", { type: "macro.completed", title: "Macro completed", detail: name, level: "success", data: { macro: name } });
  return { ok: true };
}

function handleInterrupt() {
  state.cancelRequested = true;
  if (state.mode === "wizard") {
    println(A.yellow("wizard cancelled — nothing saved"));
    state.mode = "normal";
    state.wizard = null;
  }
  showPrompt();
}

// ---------- box-drawing table ----------

function drawTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length))
  );
  const line = (l, m, r) => A.dim(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r);
  const row = (cells) =>
    A.dim("│") +
    cells.map((c, i) => " " + c + " ".repeat(widths[i] - stripAnsi(c).length) + " ").join(A.dim("│")) +
    A.dim("│");
  println(line("┌", "┬", "┐"));
  println(row(headers.map((h) => A.dim(h))));
  println(line("├", "┼", "┤"));
  for (const r of rows) println(row(r));
  println(line("└", "┴", "┘"));
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

// ============================================================
// built-in commands
// ============================================================

const PROMPT = () => A.bgreen("❯") + " ";

function showPrompt() {
  state.mode = "normal";
  startPrompt(PROMPT(), handleLine, tabComplete);
}

// built-in argument completions: command -> function(words) -> candidate list
const BUILTIN_COMPLETIONS = {
  theme: () => Object.keys(THEMES),
  help: () => helpTopicNames(),
  examples: () => ["macro", "when", "bedtime"],
  actions: () => macroActionCatalog().map((a) => a.type),
  action: () => macroActionCatalog().map((a) => a.type),
  tools: () => agentToolCatalog().map((t) => t.name),
  tool: () => agentToolCatalog().map((t) => t.name),
  doctor: () => Object.keys(state.commands),
  delete: () => Object.keys(state.commands),
  show: () => Object.keys(state.commands),
  edit: () => Object.keys(state.commands),
  run: () => Object.keys(state.commands),
  config: () => configCompletionKeys(),
  status: () => [...new Set(plugins.panels.map((p) => p.plugin)), "all"],
  panel: () => [...new Set(plugins.panels.map((p) => p.id)), "all"],
  button: () => Object.keys(slots()),
  unbind: () => Object.keys(slots()),
  label: (w) => (w.length <= 1 ? Object.keys(slots()) : []),
  bind: (w) => (w.length <= 1 ? Object.keys(slots()) : Object.keys(state.commands)), // button name, then a macro
  cancel: () => [...activeTimers.keys()].map(String),
  timer: (w) => (w.length <= 1 ? ["list", "cancel"] : ((w[0] === "cancel" || w[0] === "rm") ? [...activeTimers.keys()].map(String) : [])),
};

function completionCandidates(words) {
  // first word: all command names (deduped)
  if (words.length === 1) {
    return [...new Set([...RESERVED, ...Object.keys(state.commands), ...Object.keys(plugins.commands)])];
  }
  // later words: ask the command's completion provider
  const cmd = words[0].toLowerCase();
  if (plugins.completions[cmd]) {
    try { return plugins.completions[cmd](words.slice(1)) || []; } catch { return []; }
  }
  if (BUILTIN_COMPLETIONS[cmd]) {
    try { return BUILTIN_COMPLETIONS[cmd](words.slice(1)) || []; } catch { return []; }
  }
  return [];
}

function configCompletionKeys() {
  const keys = ["lmstudio.url", "lmstudio.model", "lmstudio.test", "agent.confirm"];
  for (const name of plugins.names) {
    for (const k of (plugins.configHints[name] || [])) keys.push(name + "." + k);
    const saved = state.config.plugins && state.config.plugins[name] ? Object.keys(state.config.plugins[name]) : [];
    for (const k of saved) keys.push(name + "." + k);
  }
  return [...new Set(keys)];
}

function editDistance(a, b) {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = old;
    }
  }
  return prev[b.length];
}

function commandSuggestion(cmd) {
  const pool = [...new Set([...RESERVED, ...Object.keys(state.commands), ...Object.keys(plugins.commands)])];
  const best = pool
    .map((c) => ({ c, d: editDistance(cmd, c) }))
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))[0];
  if (!best || best.d > Math.max(2, Math.floor(String(cmd).length / 3))) return "";
  return "  did you mean `" + best.c + "`?";
}

// longest common prefix of candidates (case-insensitive compare, original case kept)
function longestCommonPrefix(items) {
  if (!items.length) return "";
  let prefix = String(items[0]);
  for (let i = 1; i < items.length; i++) {
    const s = String(items[i]);
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j].toLowerCase() === s[j].toLowerCase()) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

function tabComplete(buffer) {
  const leadingWs = (buffer.match(/^\s*/) || [""])[0];
  const body = buffer.slice(leadingWs.length);
  const words = body.length ? body.split(/\s+/) : [""];
  const pool = completionCandidates(words);
  if (!pool.length) return null;

  // Work out which trailing token(s) form the fragment being completed, and keep
  // every leading word (the command + any subcommands/earlier args). A candidate
  // may be multi-word (e.g. "living room"), so try the last 1..N tokens and keep
  // the rest — this is what stops `govee on bed`<tab> from eating the `on`.
  let keepWords, frag, matches;
  if (words.length === 1) {
    keepWords = [];
    frag = words[0].toLowerCase();
    matches = pool.filter((c) => String(c).toLowerCase().startsWith(frag));
  } else {
    const argWords = words.slice(1);
    let found = null;
    for (let k = 1; k <= argWords.length; k++) {
      const f = argWords.slice(argWords.length - k).join(" ").toLowerCase();
      const m = pool.filter((c) => String(c).toLowerCase().startsWith(f));
      if (m.length) { found = { k, f, m }; break; }
    }
    if (!found) {
      // loose fallback: candidates containing the last token typed
      const lastTok = argWords[argWords.length - 1].toLowerCase();
      const m = lastTok ? pool.filter((c) => String(c).toLowerCase().includes(lastTok)) : [];
      if (!m.length) return null;
      found = { k: 1, f: lastTok, m };
    }
    keepWords = words.slice(0, words.length - found.k);
    frag = found.f;
    matches = found.m;
  }

  matches = [...new Set(matches.map(String))].sort((a, b) => a.localeCompare(b));
  if (!matches.length) return null;
  const rebuild = (extra) => leadingWs + keepWords.concat([extra]).join(" ");

  if (matches.length === 1) return rebuild(matches[0]) + " ";

  const lcp = longestCommonPrefix(matches);
  if (lcp.length > frag.length) return rebuild(lcp); // fill the unambiguous part, keep typing
  // already at the common prefix — list the options instead
  term.write("\r\n");
  println(A.dim("  " + matches.join("   ")));
  redrawLine();
  return null;
}

function helpTopicNames() {
  return [
    "macros", "create", "when", "agent", "do", "tools", "actions", "timers",
    "buttons", "api", "plugins", "config", "apps", "overlays", "panel",
    ...plugins.names,
  ];
}

function builtInHelpLines(topic) {
  const key = String(topic || "").toLowerCase();
  if (key === "macros" || key === "macro" || key === "create") return [
    "create <name> starts the macro wizard; show <name> previews the saved steps.",
    "Run a macro by typing its name, or use run <name> [args]. Add --dry to preview without firing.",
    "Placeholders work in action fields: {1}, {2}, {*} and defaults like {1:off}.",
    "doctor <name> checks a macro for broken steps without running it.",
  ];
  if (key === "when" || key === "conditions" || key === "conditional") return [
    "Any macro action can have a when object: {arg|tool|get, op, value?, args?, path?}.",
    "The agent can use create_branching_macro for a simple IF/ELSE with one shared condition.",
    "Manual IF/ELSE uses two real actions with the same when.tool/args/path: truthy for IF, falsy for ELSE.",
    "examples when shows a copyable Twitch live/offline pattern.",
  ];
  if (key === "agent" || key === "do" || key === "llm" || key === "lm") return [
    "do <request> lets the local model call tools and actually act.",
    "do! <request> skips the confirmation prompt for non-safe actions.",
    "tools lists what the model can call; actions lists what it can save inside macros.",
    "preview_macro lets the model dry-run a macro before run_macro fires it.",
    "For a simple IF/ELSE macro, the model should use create_branching_macro; otherwise validate_macro_actions, create_macro, then diagnose_macro.",
    "config lmstudio.test checks local model reachability and tool-call support.",
  ];
  if (key === "tools" || key === "tool") return [
    "tools [filter] lists agent-callable functions currently available to do.",
    "Read-only lookup tools run without confirmation; launching/changing things still prompts unless you use do!.",
    "For macro step types, use actions [filter] instead.",
  ];
  if (key === "actions" || key === "action") return [
    "actions [filter] lists macro step types, including plugin actions.",
    "Every action is a flat object with a type plus sibling fields, e.g. {type:'spotify', op:'play', query:'lofi'}.",
    "Use validate_macro_actions before saving complex model-generated action lists.",
  ];
  if (key === "timers" || key === "timer" || key === "alarm" || key === "alarms") return [
    "timer 15m starts a countdown; timer 25m macro_name runs a macro later.",
    "Countdown timers and macro waits show in the timer overlay; clock alarms stay out of that box.",
    "at 22:30 or alarm 9pm schedules a clock-time alarm.",
    "timers lists pending timers; cancel <id> cancels one.",
  ];
  if (key === "buttons" || key === "button" || key === "streamdeck" || key === "deck") return [
    "buttons lists named dumterm/Stream Deck buttons; buttons <name> inspects one without running it.",
    "bind <button-name> <macro-or-command> creates or updates a button, e.g. bind panic brb_mode.",
    "label <button-name> <text> changes its display label; unbind <button-name> clears it.",
    "button <button-name> runs it locally. Numeric 1-4 names still work for old Stream Deck keys.",
    "The agent can call list_buttons, get_button, set_button, label_button, clear_button, and run_button.",
  ];
  if (key === "api" || key === "control" || key === "control-api" || key === "homeassistant") return [
    "api shows localhost control API setup for Stream Deck, phones, and Home Assistant.",
    "api on/off enables or disables it; api newtoken rotates the secret token.",
    "HTTP clients need X-Dumterm-Token. The agent can enable/disable/rotate, but token viewing stays local in the api command.",
  ];
  if (key === "plugins" || key === "plugin") return [
    "Plugins add commands, macro actions, panels, state, and agent tools.",
    "Loaded plugins: " + (plugins.names.join(", ") || "none"),
    "Use help <plugin>, for example help obs or help spotify.",
  ];
  if (key === "config" || key === "settings") return [
    "config shows settings; config <key> <value> changes one.",
    "Common keys: lmstudio.url, lmstudio.model, agent.confirm, and plugin setup keys.",
    "config lmstudio.test diagnoses local model and tool-calling support.",
  ];
  if (key === "apps" || key === "open" || key === "launch") return [
    "apps <search> searches installed Windows apps.",
    "open <app|url|path> launches something immediately. Bare domains like youtube.com are treated as web URLs.",
    "Inside macros, use an open action with target set to the app, URL, or path.",
  ];
  if (key === "overlays" || key === "overlay" || key === "panel" || key === "status") return [
    "panel lists registered plugin panels.",
    "panel <name> toggles one; panel <name> on|off sets it explicitly.",
    "panel all on|off shows or hides all registered panels.",
    "status remains a compatibility alias.",
  ];
  return null;
}

function printBuiltInHelpTopic(topic) {
  const lines = builtInHelpLines(topic);
  if (!lines) return false;
  println(A.bold(String(topic).toLowerCase()) + A.dim(" help"));
  for (const line of lines) println("  " + line);
  return true;
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return showPrompt();
  const tokens = tokenize(trimmed);
  const [cmd, ...args] = tokens;
  const lower = cmd.toLowerCase();
  const dry = args.includes("--dry");
  const cleanArgs = args.filter((a) => a !== "--dry");

  try {
    switch (lower) {
      case "help": cmdHelp(cleanArgs[0]); break;
      case "commands": cmdHelp(cleanArgs[0]); break;
      case "examples": cmdExamples(cleanArgs[0]); break;
      case "actions": cmdActions(cleanArgs[0]); break;
      case "action": cmdActions(cleanArgs[0]); break;
      case "tools": cmdTools(cleanArgs[0]); break;
      case "tool": cmdTools(cleanArgs[0]); break;
      case "doctor": cmdDoctor(cleanArgs[0]); break;
      case "list": cmdList(); break;
      case "macros": cmdList(); break;
      case "show": cmdShow(cleanArgs[0]); break;
      case "create": return cmdCreate(cleanArgs[0]);
      case "edit": return cmdEdit(cleanArgs[0]);
      case "delete": await cmdDelete(cleanArgs[0]); break;
      case "run":
        if (!cleanArgs[0]) { println(A.dim("usage: run <name> [args] [--dry]")); break; }
        await executeCommand(cleanArgs[0].toLowerCase(), { dry, args: cleanArgs.slice(1) });
        break;
      case "clear": term.clear(); break;
      case "theme": await cmdTheme(cleanArgs[0]); break;
      case "crt":
        state.config.crt = !state.config.crt;
        document.body.classList.toggle("crt", state.config.crt);
        await saveConfig();
        println(A.dim("scanlines " + (state.config.crt ? "on" : "off")));
        break;
      case "config": await cmdConfig(cleanArgs); break;
      case "ask": return cmdAsk(cleanArgs.join(" "));
      case "do": return cmdDo(cleanArgs.join(" "), false);
      case "do!": return cmdDo(cleanArgs.join(" "), true);
      case "open": await cmdOpen(cleanArgs); break;
      case "status": cmdStatus(cleanArgs); break;
      case "panel": await cmdPanel(cleanArgs); break;
      case "timer": cmdTimer(cleanArgs); break;
      case "at": cmdAt(cleanArgs); break;
      case "alarm": cmdAt(cleanArgs); break;
      case "timers": cmdTimers(); break;
      case "cancel": cmdCancelTimer(cleanArgs[0]); break;
      case "matrix": return cmdMatrix();
      case "apps": await cmdApps(cleanArgs.join(" ")); break;
      case "history":
        editor.history.forEach((h, i) => println(A.dim(String(i + 1).padStart(4)) + "  " + h));
        break;
      case "exit": case "quit": window.close(); break;
      case "buttons": cmdButtons(cleanArgs); break;
      case "button": await cmdButton(cleanArgs); break;
      case "bind": cmdBind(cleanArgs); break;
      case "unbind": cmdUnbind(cleanArgs); break;
      case "label": cmdLabel(cleanArgs); break;
      case "api": await cmdApi(cleanArgs); break;
      default:
        if (state.commands[lower]) {
          await executeCommand(lower, { dry, args: cleanArgs });
        } else if (plugins.commands[lower]) {
          await plugins.commands[lower].run(cleanArgs);
        } else {
          println(A.red(`unknown command: ${cmd}`) + A.dim(commandSuggestion(cmd) || "  (try `help`)"));
        }
    }
  } catch (err) {
    println(A.red("error: " + err.message));
  }
  showPrompt();
}

function cmdHelp(topic) {
  if (topic) {
    const key = topic.toLowerCase();
    if (printBuiltInHelpTopic(key)) return;
    if (!plugins.names.includes(key)) {
      println(A.red("no help topic named '" + topic + "'") + A.dim("  try: " + helpTopicNames().slice(0, 12).join(", ")));
      return;
    }
    println(A.bold(key) + A.dim(" plugin"));
    if (plugins.help[key]) {
      for (const line of plugins.help[key]) println("  " + line);
    } else {
      // no custom help registered — auto-list the plugin's commands
      const owned = Object.entries(plugins.commands).filter(([, d]) => d.plugin === key);
      if (!owned.length) println(A.dim("  (no commands)"));
      for (const [c, def] of owned) println("  " + A.cyan(c.padEnd(18)) + A.dim(def.description));
    }
    return;
  }
  println(A.bold("dumterm") + A.dim(" — a terminal that runs your macros, not your shell"));
  println("");
  const rows = [
    ["create <name>", "build a new macro (wizard)"],
    ["examples", "copyable patterns for conditionals and macros"],
    ["actions", "macro step types available now"],
    ["tools", "agent tool calls available now"],
    ["doctor [name]", "check macros without running them"],
    ["<name> [--dry]", "run a macro (or `run <name>`)"],
    ["open <app|url>", "launch an app or URL without making a macro"],
    ["list", "all macros"],
    ["show <name>", "macro detail"],
    ["edit <name>", "add/remove actions"],
    ["delete <name>", "remove a macro"],
    ["ask <question>", "ask the LLM (config lmstudio first)"],
    ["do <request>", "let the LLM act for you · follow-ups continue · do reset clears"],
    ["timer <dur> [macro]", "countdown — 90s, 15m, 1h30m (bare number = minutes)"],
    ["at <HH:MM> [macro]", "run a macro (or just chime) at a clock time"],
    ["timers / cancel <id>", "see and cancel pending timers"],
    ["apps <search>", "search installed apps"],
    ["theme <name>", "phosphor · amber · ice · mono"],
    ["crt", "toggle scanlines"],
    ["config", "view/set settings"],
    ["panel [name] [on|off]", "show/hide registered plugin panels"],
    ["clear / exit", "you know these"],
  ];
  for (const [c, d] of rows) println("  " + A.cyan(c.padEnd(18)) + A.dim(d));
  println("");
  println(A.dim("  macros take arguments: put {1} {2} or {*} in any action field, then `lights red`"));
  println(A.dim("  defaults work too: {1:off} · quotes group words: lights \"warm white\""));
  println(A.dim("  conditional steps: in `create`, [if] gates a step — e.g. tool twitch_is_live streamer=ninja path=live truthy"));
  println(A.dim("  drop a shortcut/file onto the window during `create` to add it"));
  println(A.dim("  Ctrl+` summons dumterm from anywhere · Ctrl+C cancels"));
  println(A.dim("  ✦ there may be easter eggs"));
  if (plugins.names.length) {
    println("");
    println(A.dim("  plugins loaded: ") + plugins.names.map((n) => A.cyan(n)).join(", "));
    println(A.dim("  → `help <plugin>` for its commands, e.g. ") + A.cyan("help " + plugins.names[0]));
  }
}

function cmdExamples(topic) {
  const t = String(topic || "").toLowerCase();
  if (t && !["macro", "macros", "when", "bedtime"].includes(t)) {
    println(A.dim("examples topics: macro · when · bedtime"));
    return;
  }
  println(A.bold("macro examples"));
  println("");
  println(A.cyan("Conditional IF/ELSE pattern"));
  println(A.dim("  Put the same condition on both real actions; use truthy for IF and falsy for ELSE."));
  println("  " + A.dim("IF live:  ") + `{"type":"open","target":"https://www.twitch.tv/ninja","when":{"tool":"twitch_is_live","args":{"streamer":"ninja"},"path":"live","op":"truthy"}}`);
  println("  " + A.dim("ELSE:     ") + `{"type":"spotify","op":"play","query":"lofi","when":{"tool":"twitch_is_live","args":{"streamer":"ninja"},"path":"live","op":"falsy"}}`);
  println("");
  println(A.cyan("Bedtime-style action list"));
  println("  weather");
  println("  weather Chicago");
  println("  open Ninja stream only if twitch_is_live.live is truthy");
  println("  spotify play lofi only if twitch_is_live.live is falsy");
  println("  wait 300000ms");
  println("  govee off desk lamp");
  println("  govee off office");
  println("");
  println(A.dim("Tip: `show <macro>` shows the clean saved shape after the LLM creates it."));
}

function cmdActions(filter) {
  const q = String(filter || "").toLowerCase();
  const rows = macroActionCatalog()
    .filter((a) => !q || a.type.toLowerCase().includes(q) || String(a.source || "").toLowerCase().includes(q))
    .map((a) => [
      A.cyan(a.type),
      A.dim(a.source || ""),
      A.dim(truncate(a.fields || "", 86)),
    ]);
  if (!rows.length) return println(A.dim("no action types match " + filter));
  drawTable(["type", "from", "fields / hint"], rows);
  println(A.dim("  conditionals: add when:{tool,args,path,op} to any action; `examples when` shows IF/ELSE."));
}

function agentToolCatalog() {
  return AGENT_TOOLS.concat(plugins.agentTools).map((t) => ({
    name: t.function && t.function.name,
    description: (t.function && t.function.description) || "",
  })).filter((t) => t.name);
}

function cmdTools(filter) {
  const q = String(filter || "").toLowerCase();
  const rows = agentToolCatalog()
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    .map((t) => [A.cyan(t.name), A.dim(truncate(t.description, 96))]);
  if (!rows.length) return println(A.dim("no agent tools match " + filter));
  drawTable(["tool", "what it does"], rows);
  println(A.dim("  these are what `do ...` can call; macro step types are listed by `actions`."));
}

function cmdDoctor(name) {
  const names = name ? [name.toLowerCase()] : Object.keys(state.commands).sort();
  if (!names.length) return println(A.dim("no macros to check yet"));
  let bad = 0;
  for (const n of names) {
    const r = inspectMacro(n);
    if (r.error) {
      bad++;
      println(A.red("x " + n) + A.dim("  " + r.error));
      continue;
    }
    if (r.ok && !r.warnings.length) {
      println(A.green("ok ") + A.cyan(r.name) + A.dim("  " + r.actions + " action" + (r.actions === 1 ? "" : "s")));
      continue;
    }
    if (!r.ok) bad++;
    println((r.ok ? A.yellow("warn ") : A.red("x ")) + A.cyan(r.name) + A.dim("  " + r.actions + " action" + (r.actions === 1 ? "" : "s")));
    for (const issue of r.issues) println("  " + A.red(issue));
    for (const warning of r.warnings) println("  " + A.yellow(warning));
  }
  if (!name) println(A.dim("checked " + names.length + " macro" + (names.length === 1 ? "" : "s") + (bad ? " · " + bad + " need attention" : "")));
}

function cmdList() {
  const names = Object.keys(state.commands).sort();
  if (!names.length) {
    println(A.dim("no macros yet — try ") + A.cyan("create worktime"));
    return;
  }
  drawTable(
    ["command", "actions", "description"],
    names.map((n) => [
      A.green(n),
      String(state.commands[n].actions.length),
      A.dim(state.commands[n].description || ""),
    ])
  );
}

function cmdShow(name) {
  if (!name) return println(A.dim("usage: show <name>"));
  const c = state.commands[name.toLowerCase()];
  if (!c) return println(A.red("no such command: " + name));
  println(A.green(name) + (c.description ? A.dim("  — " + c.description) : ""));
  c.actions.forEach((a, i) => println(A.dim(`  ${i + 1}. `) + describeAction(a)));
}

async function cmdDelete(name) {
  if (!name) return println(A.dim("usage: delete <name>"));
  const key = name.toLowerCase();
  if (!state.commands[key]) return println(A.red("no such command: " + name));
  delete state.commands[key];
  await saveCommands();
  println(A.green("✓ deleted ") + key);
}

async function cmdOpen(args) {
  if (!args.length) return println(A.dim("usage: open <app name | path | url>"));
  const target = args.join(" ");
  const resolved = await window.dum.resolveLaunch(target);
  print(A.dim("opening " + target + " "));
  const r = await window.dum.launch(resolved);
  term.write("\r\x1b[K");
  println(r.ok ? A.green("✓ opened ") + target : A.red("✗ " + (r.error || "failed")));
}

// ---------- timers & alarms ----------

let timerSeq = 0;
const activeTimers = new Map(); // id -> {desc, fireAt, timeout, macro, args}

function parseDuration(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60000; // bare number = minutes
  let total = 0, matched = false;
  const re = /(\d+)\s*(h|m|s)/gi;
  let m;
  while ((m = re.exec(s))) {
    matched = true;
    const n = parseInt(m[1], 10);
    total += n * (m[2].toLowerCase() === "h" ? 3600000 : m[2].toLowerCase() === "m" ? 60000 : 1000);
  }
  return matched ? total : null;
}

function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // already past → tomorrow
  return d;
}

// lenient: accepts "9pm", "9:30 pm", "21:00", "9 PM", "noon", "midnight"
function parseClockLoose(s) {
  s = String(s || "").trim().toLowerCase();
  if (s === "noon") s = "12:00pm";
  if (s === "midnight") s = "12:00am";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return parseClock(s); // fall back to strict HH:MM
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function fmtRemaining(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + "h " : "") + (m ? m + "m " : "") + sec + "s";
}

function timerSummary(t) {
  return {
    remainingMs: Math.max(0, t.fireAt - Date.now()),
    desc: t.desc,
    macro: t.macro || null,
    kind: t.kind || "timer",
    overlay: t.overlay !== false,
  };
}

function scheduleTimer(fireAt, macro, args, desc, opts = {}) {
  const id = ++timerSeq;
  const delay = fireAt - Date.now();
  const timeout = setTimeout(async () => {
    activeTimers.delete(id);
    emitEvent("core", { type: "timer.fired", title: opts.kind === "alarm" ? "Alarm fired" : "Timer fired", detail: desc, level: "attention", data: { id: id, kind: opts.kind || "timer", macro: macro || null } });
    if (!opts.silent) {
      beep();
      try { new Notification("dumterm", { body: desc }); } catch {}
    }
    // interject above whatever prompt is live
    const wasActive = editor.active;
    term.write("\r\x1b[K");
    println(sparkleLine());
    println(A.yellow("⏰ " + desc));
    if (opts.onFire) await opts.onFire();
    if (macro) {
      if (state.commands[macro]) await executeCommand(macro, { args });
      else println(A.red("  ✗ macro vanished: " + macro));
    }
    println(sparkleLine());
    if (wasActive) redrawLine();
  }, delay);
  activeTimers.set(id, { desc, fireAt, timeout, macro, args, kind: opts.kind || "timer", overlay: opts.overlay !== false, silent: !!opts.silent });
  emitEvent("core", { type: "timer.scheduled", title: opts.kind === "alarm" ? "Alarm scheduled" : "Timer scheduled", detail: desc + " in " + fmtRemaining(delay), data: { id: id, kind: opts.kind || "timer", fireAt: fireAt, macro: macro || null } });
  return id;
}

function cmdTimer(args) {
  const sub = (args[0] || "").toLowerCase();
  if (!sub) return println(A.dim("usage: timer <duration> [macro] · timer list · timer cancel <id>   e.g. timer 15m · timer 1h30m lights red"));
  // management lives under `timer` too (the `timers` and `cancel` commands still work as aliases)
  if (sub === "list" || sub === "ls") return cmdTimers();
  if (sub === "cancel" || sub === "rm" || sub === "stop") return cmdCancelTimer(args[1]);
  const ms = parseDuration(args[0]);
  if (ms == null || ms <= 0) return println(A.red("can't parse duration: " + args[0]) + A.dim("  (try 90s, 15m, 1h30m, or bare minutes)"));
  const macro = args[1] ? args[1].toLowerCase() : null;
  if (macro && !state.commands[macro]) return println(A.red("no such macro: " + macro));
  const desc = macro
    ? `timer done → running '${macro}'`
    : `timer done (${args[0]})`;
  const id = scheduleTimer(Date.now() + ms, macro, args.slice(2), desc, { kind: "timer", overlay: true });
  println(A.green("✓ ") + `timer #${id} set — fires in ${fmtRemaining(ms)}` + (macro ? A.dim(" → " + macro) : ""));
}

function cmdAt(args) {
  if (!args[0]) return println(A.dim("usage: alarm <time> [macro] [args]   e.g. alarm 9pm winddown · alarm 22:30 winddown"));
  const when = parseClockLoose(args[0]);
  if (!when) return println(A.red("can't parse time: " + args[0]) + A.dim("  (try 9pm, 9:30pm, or 22:30)"));
  const macro = args[1] ? args[1].toLowerCase() : null;
  if (macro && !state.commands[macro]) return println(A.red("no such macro: " + macro));
  const desc = macro ? `it's ${args[0]} → running '${macro}'` : `alarm: ${args[0]}`;
  const id = scheduleTimer(when.getTime(), macro, args.slice(2), desc, { kind: "alarm", overlay: false });
  const dayNote = when.getDate() !== new Date().getDate() ? " tomorrow" : "";
  println(A.green("✓ ") + `alarm #${id} set for ${args[0]}${dayNote}` + (macro ? A.dim(" → " + macro) : ""));
}

function cmdTimers() {
  if (!activeTimers.size) return println(A.dim("no timers running"));
  for (const [id, t] of activeTimers) {
    println(A.dim(`  #${id}  `) + fmtRemaining(t.fireAt - Date.now()).padEnd(10) + A.dim((t.kind || "timer") + " · " + t.desc));
  }
  println(A.dim("  (timers live in this session — they don't survive closing dumterm)"));
}

function cmdCancelTimer(idStr) {
  const id = parseInt(idStr, 10);
  if (!id || !activeTimers.has(id)) return println(A.dim("usage: cancel <id> — see `timers`"));
  clearTimeout(activeTimers.get(id).timeout);
  activeTimers.delete(id);
  emitEvent("core", { type: "timer.cancelled", title: "Timer cancelled", detail: "#" + id, level: "warning", data: { id: id } });
  println(A.yellow("⊘ timer #" + id + " cancelled"));
}

// ---------- matrix easter egg ----------

function cmdMatrix() {
  state.mode = "matrix";
  term.write("\x1b[?1049h\x1b[?25l"); // alt screen, hide cursor
  const cols = term.cols, rows = term.rows;
  const drops = Array.from({ length: cols }, () => (Math.random() * rows) | 0);
  const chars = "ｱｲｳｴｵｶｷｸｹｺﾊﾋﾌﾍﾎ01ﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛｦﾝ";
  const interval = setInterval(() => {
    let out = "";
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.6) continue;
      const r = drops[c];
      const ch = chars[(Math.random() * chars.length) | 0];
      out += `\x1b[${r + 1};${c + 1}H\x1b[92m${ch}`;
      const fade = r - 6;
      if (fade >= 0) out += `\x1b[${fade + 1};${c + 1}H\x1b[32m${chars[(Math.random() * chars.length) | 0]}`;
      const erase = r - 14;
      if (erase >= 0) out += `\x1b[${erase + 1};${c + 1}H `;
      drops[c] = r + 1 >= rows ? 0 : r + 1;
    }
    term.write(out + "\x1b[0m");
  }, 65);
  state.matrixStop = () => {
    clearInterval(interval);
    term.write("\x1b[?25h\x1b[?1049l"); // restore
    state.matrixStop = null;
    println(A.dim("wake up, josh…"));
    showPrompt();
  };
}

async function cmdTheme(name) {
  if (!name || !THEMES[name]) {
    println(A.dim("themes: " + Object.keys(THEMES).join(" · ") + "  (current: " + state.config.theme + ")"));
    return;
  }
  state.config.theme = name;
  term.options.theme = THEMES[name];
  await saveConfig();
  println(A.dim("theme → ") + name);
}

async function cmdConfig(args) {
  if (!args.length) {
    println(A.dim("  lmstudio.url     ") + (state.config.lmstudioUrl || A.dim("(not set)")));
    println(A.dim("  lmstudio.model   ") + (state.config.lmstudioModel || A.dim("(default)")));
    println(A.dim("  agent.confirm    ") + (state.config.agentConfirm === false ? A.yellow("off") : "on"));
    // each INSTALLED plugin declares the config it needs (ctx.configHint); show those
    // (plus anything already saved) with value or (not set), so the user never guesses.
    // A removed plugin isn't loaded, so its keys simply drop off the list.
    for (const pl of plugins.names) {
      const pc = state.config.plugins?.[pl] || {};
      const keys = [...new Set([...(plugins.configHints[pl] || []), ...Object.keys(pc)])];
      for (const k of keys) {
        const ek = ciKey(pc, k);
        const has = ek != null && pc[ek] != null && pc[ek] !== "";
        const v = has ? (/secret|token|password/i.test(k) ? "••••••••" : pc[ek]) : A.dim("(not set)");
        println(A.dim(`  ${pl}.${k} `) + v);
      }
    }
    println("");
    println(A.dim("  set with: config <key> <value>   e.g. config lmstudio.url http://mac:1234  ·  config <plugin>.<key> <value>"));
    println(A.dim("  diagnose: config lmstudio.test   (checks server, model, and tool calling)"));
    return;
  }
  const [key, ...rest] = args;
  const val = rest.join(" ");
  if (key === "lmstudio.test" || key === "test") return cmdLmTest();
  // plugin config: config <pluginname>.<key> <value>
  if (key.includes(".") && plugins.names.includes(key.split(".")[0])) {
    const [pl, ...kp] = key.split(".");
    const k = kp.join(".");
    state.config.plugins = state.config.plugins || {};
    state.config.plugins[pl] = state.config.plugins[pl] || {};
    const ns = state.config.plugins[pl];
    ns[ciKey(ns, k) || k] = val; // reuse an existing case-variant key so clientId/clientid don't split
    await saveConfig();
    return println(A.green("✓ ") + key + A.dim(" set"));
  }
  if (key === "lmstudio.url") state.config.lmstudioUrl = val;
  else if (key === "lmstudio.model") state.config.lmstudioModel = val;
  else if (key === "agent.confirm") {
    const on = !/^(off|false|no|0)$/i.test(val);
    state.config.agentConfirm = on;
    await saveConfig();
    return println(A.green("✓ ") + "agent confirmation " + (on ? "on" : A.yellow("off") + A.dim(" — `do` runs actions without asking")));
  }
  else return println(A.red("unknown setting: " + key));
  await saveConfig();
  println(A.green("✓ ") + key + A.dim(" set"));
}

async function cmdApps(search) {
  print(A.dim("loading app list… "));
  const apps = await window.dum.listApps();
  term.write("\r\x1b[K");
  const filtered = search
    ? apps.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : apps.slice(0, 30);
  if (!filtered.length) return println(A.dim("no matches"));
  filtered.slice(0, 30).forEach((a) => println("  " + a.name + A.dim("  " + truncate(a.appId, 50))));
  if (!search && apps.length > 30) println(A.dim(`  … ${apps.length - 30} more — try \`apps <search>\``));
}


// ---------- LM Studio diagnostic ----------

async function cmdLmTest() {
  if (!state.config.lmstudioUrl) return println(A.red("no LM Studio URL set"));
  print(A.dim("probing " + state.config.lmstudioUrl + " … "));
  const p = await window.dum.lmProbe({ url: state.config.lmstudioUrl, model: state.config.lmstudioModel });
  term.write("\r\x1b[K");
  const mark = (v) => (v === "ok" ? A.green("✓") : A.red("✗ " + v));
  println(A.dim("reachable   ") + (p.reachable ? A.green("✓") : A.red("✗ " + (p.error || "no"))));
  if (!p.reachable) return println(A.dim("  → is the server running and serving on the local network?"));
  if (p.models) {
    const hit = state.config.lmstudioModel && p.models.includes(state.config.lmstudioModel);
    println(A.dim("model       ") + (state.config.lmstudioModel
      ? (hit ? A.green("✓ " + state.config.lmstudioModel) : A.red("✗ '" + state.config.lmstudioModel + "' not loaded"))
      : A.dim("(using whatever's loaded)")));
    if (!hit) println(A.dim("  loaded: ") + p.models.join(", "));
  }
  println(A.dim("plain chat  ") + mark(p.plain));
  println(A.dim("tool call   ") + mark(p.tools));
  if (p.plain === "ok" && p.tools !== "ok") {
    println("");
    println(A.yellow("plain chat works but tool calls fail") + A.dim(" — this model build can't do tool calling,"));
    println(A.dim("  or its template lacks tool support. `ask` will work; `do` won't."));
    println(A.dim("  try a tool-tuned model (Qwen 2.5) via config lmstudio.model <id>"));
  } else if (p.tools === "ok") {
    println("");
    println(A.green("tools are working — `do` should be good to go"));
  }
}

// ---------- agent loop (`do`) ----------

const AGENT_TOOLS = [
  { type: "function", function: { name: "list_macros", description: "List all saved macros with their descriptions and action counts. Call this first if you need to run something the user referred to by a nickname.", parameters: { type: "object", properties: { filter: { type: "string", description: "Optional substring to filter macro names; omit or pass empty for all." } } } } },
  { type: "function", function: { name: "list_action_types", description: "List macro action types currently available, including plugin actions and their fields. Use this before creating a complex macro if you are unsure which action shape to use.", parameters: { type: "object", properties: { filter: { type: "string", description: "optional type/plugin filter" } } } } },
  { type: "function", function: { name: "validate_macro_actions", description: "Validate and normalize a proposed macro action list WITHOUT saving it. Use this before create_macro for complex conditionals or plugin actions. Returns canonical actions or a clear error.", parameters: { type: "object", properties: { actions: { type: "array", items: { type: "object" } } }, required: ["actions"] } } },
  { type: "function", function: { name: "diagnose_macro", description: "Inspect a saved macro without running it. Finds broken chained macros, bad timers, unknown action types, and condition/tool issues. Use after creating or editing a macro.", parameters: { type: "object", properties: { name: { type: "string", description: "macro name" } }, required: ["name"] } } },
  { type: "function", function: { name: "list_apps", description: "Search installed Windows apps by name before launching one. Returns app names and launch IDs.", parameters: { type: "object", properties: { search: { type: "string", description: "optional app name search" } } } } },
  { type: "function", function: { name: "get_status", description: "Get dumterm status: macro count, timers, button bindings, and plugin status text.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_help", description: "Get concise dumterm help for a topic such as macros, when, do, tools, actions, timers, buttons, plugins, config, apps, or overlays.", parameters: { type: "object", properties: { topic: { type: "string", description: "help topic" } } } } },
  { type: "function", function: { name: "control_api_status", description: "Get local control API status for Stream Deck/Home Assistant setup. Does not reveal the secret token.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "set_control_api_enabled", description: "Enable or disable the localhost control API used by Stream Deck and automation clients.", parameters: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } } },
  { type: "function", function: { name: "rotate_control_api_token", description: "Generate a new local control API token. This invalidates existing Stream Deck/API clients until they are updated.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_timers", description: "List active timers, macro waits, and alarms, including IDs usable with cancel_timer. Results include kind and whether it appears in the timer overlay.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "cancel_timer", description: "Cancel an active timer/alarm by ID. Use list_timers first if you do not know the ID.", parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } } },
  { type: "function", function: { name: "run_macro", description: "Run a saved macro by exact name. Optional args fill the macro's {1},{2},{*} placeholders.", parameters: { type: "object", properties: { name: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["name"] } } },
  { type: "function", function: { name: "preview_macro", description: "Dry-run a saved macro by exact name. Shows what would run, including filled arguments and conditional skip/run decisions, without firing macro actions.", parameters: { type: "object", properties: { name: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["name"] } } },
  { type: "function", function: { name: "create_macro", description: "Save a NEW reusable macro the user can call later by name. Use this (not one-off actions) whenever the user asks to create/make/save a command or macro. Each action is one step; supported types: open (target), key (keys), webhook (url, method, body), command (name of another macro to chain), wait (ms; non-blocking, resumes remaining steps later and appears in the timer overlay), timer (schedule a macro after a delay — fields: after like \"5m\", run = macro name; non-blocking countdown, appears in the timer overlay). Action fields may contain {1},{2},{*} placeholders for arguments. Any action may include an optional 'when' condition object so the step only runs when it passes — shape: {arg|tool|get, op, value, args?, path?}; ops: eq, ne, contains, not_contains, matches, gt, lt, exists, truthy, falsy (= NOT truthy — use for else branches), not, status. For an otherwise/else branch, put the SAME condition on the other step with op 'falsy'; the 'when' checks inline, so NEVER add a separate step just to run the check tool. Example, turn lights red only when a streamer is live: {\"type\":\"command\",\"name\":\"lights\",\"when\":{\"tool\":\"twitch_is_live\",\"args\":{\"streamer\":\"ninja\"},\"path\":\"live\",\"op\":\"truthy\"}}.", parameters: { type: "object", properties: {
    name: { type: "string", description: "lowercase name, letters/digits/-/_ only" },
    description: { type: "string" },
    actions: { type: "array", items: { type: "object", properties: {
      type: { type: "string", enum: ["open", "key", "webhook", "command", "wait", "timer"] },
      target: { type: "string" }, keys: { type: "string" }, url: { type: "string" },
      method: { type: "string" }, body: { type: "string" }, op: { type: "string" },
      name: { type: "string" }, ms: { type: "number" }, after: { type: "string" }, run: { type: "string" }, label: { type: "string" },
      when: { type: "object", description: "optional condition: {arg|tool|get, op, value, args?, path?}" },
    }, required: ["type"] } },
  }, required: ["name", "actions"] } } },
  { type: "function", function: { name: "create_branching_macro", description: "Save a macro with a simple IF/ELSE branch. Prefer this when the user says 'if X, do A; otherwise do B'. The condition is evaluated once per macro pass, so both branches use the same result. Use a truthy/falsy condition such as {tool:'twitch_is_live',args:{streamer:'ninja'},path:'live',op:'truthy'}. Put ordinary flat actions before the decision in before_actions, branch actions in if_actions / else_actions, and later actions such as wait and lights-off in after_actions. Do not add a standalone tool/check action for the condition.", parameters: { type: "object", properties: {
    name: { type: "string", description: "lowercase name, letters/digits/-/_ only" },
    description: { type: "string" },
    before_actions: { type: "array", items: { type: "object" }, description: "actions that always run before the decision" },
    condition: { type: "object", description: "branch condition: {tool,args,path,op:'truthy'} or {arg,op} or {get,method,path,op:'truthy'}" },
    if_actions: { type: "array", items: { type: "object" }, description: "flat actions when the condition passes" },
    else_actions: { type: "array", items: { type: "object" }, description: "flat actions when the condition does not pass" },
    after_actions: { type: "array", items: { type: "object" }, description: "actions that always run afterward, such as wait and lights off" },
  }, required: ["name", "condition"] } } },
  { type: "function", function: { name: "delete_macro", description: "Delete a saved macro by name.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "launch", description: "Open an application, file path, or URL. For apps use a common name like 'chrome', 'spotify', 'discord'.", parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } } },
  { type: "function", function: { name: "set_timer", description: "Start a countdown timer for a DURATION from now. duration like '30m', '1h30m', '90s'. Countdown timers show in the timer overlay. For a specific clock time (like 9pm) use set_alarm instead. Optionally run a macro when it fires.", parameters: { type: "object", properties: { duration: { type: "string" }, macro: { type: "string" } }, required: ["duration"] } } },
  { type: "function", function: { name: "set_alarm", description: "Schedule something for a specific CLOCK TIME (e.g. '9pm', '9:30pm', '21:00', 'noon'). Use this for absolute times of day. Alarms do not show in the timer overlay. If the time has already passed today, it fires tomorrow. Optionally run a macro when it fires.", parameters: { type: "object", properties: { time: { type: "string", description: "clock time like '9pm', '9:30 pm', '21:00'" }, macro: { type: "string", description: "optional macro name to run when it fires" } }, required: ["time"] } } },
  { type: "function", function: { name: "http_request", description: "Send an HTTP request to a webhook (e.g. an n8n endpoint).", parameters: { type: "object", properties: { url: { type: "string" }, method: { type: "string" }, body: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "get_macro", description: "Get one macro's full action list with 1-based indexes, so you can edit it precisely. Call this before add/remove/move so you know the current steps.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "add_macro_action", description: "Insert ONE action into an existing macro at a 1-based position (omit position to append). The action has the same shape as create_macro's actions and may include a 'when' condition.", parameters: { type: "object", properties: { name: { type: "string" }, position: { type: "number", description: "1-based index to insert before; omit to append" }, action: { type: "object", properties: { type: { type: "string" }, target: { type: "string" }, keys: { type: "string" }, url: { type: "string" }, method: { type: "string" }, body: { type: "string" }, op: { type: "string" }, name: { type: "string" }, ms: { type: "number" }, label: { type: "string" }, when: { type: "object" } }, required: ["type"] } }, required: ["name", "action"] } } },
  { type: "function", function: { name: "remove_macro_action", description: "Remove the action at a 1-based index from a macro.", parameters: { type: "object", properties: { name: { type: "string" }, index: { type: "number" } }, required: ["name", "index"] } } },
  { type: "function", function: { name: "move_macro_action", description: "Move an action within a macro from one 1-based index to another.", parameters: { type: "object", properties: { name: { type: "string" }, from: { type: "number" }, to: { type: "number" } }, required: ["name", "from", "to"] } } },
  { type: "function", function: { name: "set_macro_description", description: "Set or replace a macro's one-line description.", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } } },
  { type: "function", function: { name: "list_buttons", description: "List named Stream Deck/dumterm buttons and what each is bound to.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_button", description: "Inspect one named Stream Deck/dumterm button without running it. Use this to verify an assignment before configuring a Stream Deck key.", parameters: { type: "object", properties: { button: { type: "string", description: "button name, such as panic or brb" } }, required: ["button"] } } },
  { type: "function", function: { name: "set_button", description: "Create or update a named dumterm/Stream Deck button such as 'panic', 'brb', or '1'. The Stream Deck plugin runs it by the same button name.", parameters: { type: "object", properties: { button: { type: "string", description: "required button name, e.g. panic, brb, clip, or 1" }, slot: { type: "number", description: "legacy alias for button 1-4; prefer button" }, command: { type: "string", description: "a macro name or command line, e.g. 'focus_mode' or 'discord togglemute'" }, name: { type: "string", description: "optional display label" } }, required: ["button", "command"] } } },
  { type: "function", function: { name: "label_button", description: "Change the display label for a named button without changing what it runs.", parameters: { type: "object", properties: { button: { type: "string", description: "required button name" }, slot: { type: "number", description: "legacy alias for button 1-4; prefer button" }, name: { type: "string", description: "new display label" } }, required: ["button", "name"] } } },
  { type: "function", function: { name: "clear_button", description: "Unbind/clear a named Stream Deck/dumterm button.", parameters: { type: "object", properties: { button: { type: "string", description: "required button name" }, slot: { type: "number", description: "legacy alias for button 1-4; prefer button" } }, required: ["button"] } } },
  { type: "function", function: { name: "run_button", description: "Run whatever is bound to a named dumterm/Stream Deck button.", parameters: { type: "object", properties: { button: { type: "string", description: "required button name" }, slot: { type: "number", description: "legacy alias for button 1-4; prefer button" } }, required: ["button"] } } },
];

const AGENT_SYSTEM =
  "You are the agent inside dumterm, a macro terminal on the user's Windows PC. " +
  "You act by calling tools — actually perform actions rather than describing them. " +
  "Prefer running an existing saved macro when one clearly fits. " +
  "You can edit existing macros: call get_macro to see its steps, then add_macro_action / remove_macro_action / move_macro_action / set_macro_description. " +
  "For complex saved macros, call list_action_types if unsure, validate_macro_actions before create_macro, then diagnose_macro after saving or editing. " +
  "To make a step conditional, give it a 'when' object (e.g. only turn lights red when a streamer is live). " +
  "For an IF/ELSE inside a saved macro, prefer create_branching_macro: it accepts before_actions, one condition, if_actions, else_actions, and after_actions, and evaluates the condition only once. Do not create a separate tool step just to check the condition. " +
  "Macro actions are flat objects like {type:'spotify', op:'play', query:'lofi'}, never nested objects like {spotify:{...}}. " +
  "The conversation continues across requests, so the user may refer back to what you just did. " +
  "Keep any text brief. When finished, give a one-line summary of what you did. " +
  "If a request is ambiguous or could be destructive and you're unsure, ask instead of guessing.";

function macroContext() {
  const names = Object.keys(state.commands);
  if (!names.length) return "\n\nThere are no saved macros yet.";
  return "\n\nSaved macros: " + names.map((n) => {
    const c = state.commands[n];
    return n + (c.description ? ` (${c.description})` : "");
  }).join("; ") + ".";
}

// human-readable one-liner for a proposed tool call
function describeToolCall(name, a) {
  switch (name) {
    case "list_macros": return "look up your macros";
    case "list_action_types": return "look up available macro action types";
    case "validate_macro_actions": return "validate a macro action list";
    case "diagnose_macro": return `check macro ${A.cyan(a.name)} for issues`;
    case "list_apps": return "search installed apps" + (a.search ? " for " + A.cyan(a.search) : "");
    case "get_status": return "read dumterm status";
    case "get_help": return "read help" + (a.topic ? " for " + A.cyan(a.topic) : "");
    case "control_api_status": return "read control API status";
    case "set_control_api_enabled": return (a.enabled ? "enable" : "disable") + " control API";
    case "rotate_control_api_token": return "rotate control API token";
    case "list_timers": return "list active timers";
    case "cancel_timer": return `cancel timer ${A.cyan(a.id)}`;
    case "run_macro": return `run macro ${A.cyan(a.name)}` + (a.args?.length ? " " + a.args.join(" ") : "");
    case "preview_macro": return `preview macro ${A.cyan(a.name)}` + (a.args?.length ? " " + a.args.join(" ") : "");
    case "create_macro": {
      const acts = (a.actions || []).map((x) => describeAction(x)).join(", ");
      return `save macro ${A.cyan(a.name)} = [${acts}]`;
    }
    case "create_branching_macro":
      return `save branching macro ${A.cyan(a.name)} with IF/ELSE actions`;
    case "delete_macro": return `delete macro ${A.cyan(a.name)}`;
    case "launch": return `open ${A.cyan(a.target)}`;
    case "set_timer": return `set a ${A.cyan(a.duration)} timer` + (a.macro ? ` → ${a.macro}` : "");
    case "set_alarm": return `set an alarm for ${A.cyan(a.time)}` + (a.macro ? ` → ${a.macro}` : "");
    case "http_request": return `${a.method || "POST"} ${A.cyan(a.url)}`;
    case "get_macro": return `read macro ${A.cyan(a.name)}`;
    case "add_macro_action": return `add a ${A.cyan(a.action?.type || "?")} step to ${A.cyan(a.name)}` + (a.position ? ` at #${a.position}` : "") + (a.action?.when ? A.dim(" ⟨if " + describeWhen(a.action.when) + "⟩") : "");
    case "remove_macro_action": return `remove step #${a.index} from ${A.cyan(a.name)}`;
    case "move_macro_action": return `move step #${a.from} → #${a.to} in ${A.cyan(a.name)}`;
    case "set_macro_description": return `describe ${A.cyan(a.name)}: ${truncate(String(a.description || ""), 40)}`;
    case "list_buttons": return "list your named buttons";
    case "get_button": return `inspect button ${A.cyan(a.button)}`;
    case "set_button": return `bind button ${A.cyan(a.button || a.slot)} → ${a.command}` + (a.name ? ` ("${a.name}")` : "");
    case "label_button": return `label button ${A.cyan(a.button || a.slot)} "${a.name}"`;
    case "clear_button": return `clear button ${A.cyan(a.button || a.slot)}`;
    case "run_button": return `run button ${A.cyan(a.button || a.slot)}`;
    default: return name.replace(/_/g, " ") + (Object.keys(a).length ? " " + A.cyan(Object.values(a).join(" ")) : "");
  }
}

// Core read-only tools that run without a confirm. Plugins declare their OWN safe
// tools via ctx.safeTools([...]) (see plugins.safeTools), so no plugin tool names
// are hardcoded here.
const SAFE_TOOLS = new Set([
  "list_macros", "list_action_types", "validate_macro_actions", "diagnose_macro", "list_apps",
  "get_status", "get_help", "control_api_status", "list_timers", "get_macro", "list_buttons", "get_button",
  "set_timer", "set_alarm",
]);
const isSafeTool = (name) => SAFE_TOOLS.has(name) || plugins.safeTools.has(name);

const ACTION_KEYS = new Set(["open", "launch", "key", "webhook", "command", "wait", "timer", "check"]);

function isEmptyObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0;
}

function canonicalActionType(k) {
  if (k === "launch") return "open";
  return k;
}

// Smaller models often return nested action objects like
// {spotify:{op:"play", query:"lofi"}} or several of those in one object.
// Expand them before validating so we save the normal flat macro format.
function expandAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [raw];
  if (typeof raw.type === "string") return [raw];
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    if (!ACTION_KEYS.has(k) && !plugins.actions[k]) continue;
    const inner = { ...v, type: canonicalActionType(k) };
    if (raw.when && !inner.when) inner.when = raw.when;
    out.push(inner);
  }
  return out.length ? out : [raw];
}

async function normalizeActionList(raw) {
  const clean = [];
  for (const item of expandAction(raw)) {
    const result = await normalizeAction(item);
    if (typeof result === "string") return result;
    clean.push(result);
  }
  return clean;
}

function fillConditionArgs(actions) {
  const seen = {};
  for (const a of actions) {
    if (a.type === "check" && a.tool && a.args && Object.keys(a.args).length) {
      seen[a.tool] = a.args;
    }
    if (a.when && a.when.tool && (!a.when.args || !Object.keys(a.when.args).length) && seen[a.when.tool]) {
      a.when.args = seen[a.when.tool];
    }
  }
}

// shared action validator/normalizer — used by create_macro, add_macro_action, and the wizard
async function normalizeAction(raw) {
  if (!raw || typeof raw !== "object") return "error: action must be an object";
  if (typeof raw.type !== "string") return "error: 'type' must be a string like \"govee\" or \"spotify\", with the other fields (op/target/value/query) as siblings — not nested inside 'type'";
  const t = raw.type;
  let action;
  if (t === "open" || t === "launch") {
    if (!raw.target) return "error: open action needs a target";
    const target = await window.dum.resolveLaunch(raw.target); // resolve plain app names at save time
    action = { type: "open", target, label: raw.label || raw.target };
  } else if (t === "key") {
    if (!raw.keys) return "error: key action needs keys";
    action = { type: "key", keys: raw.keys };
  } else if (t === "webhook") {
    if (!raw.url) return "error: webhook action needs a url";
    action = { type: "webhook", url: raw.url, method: (raw.method || "POST").toUpperCase(), body: raw.body || undefined };
  } else if (t === "command") {
    if (!raw.name) return "error: command action needs a macro name";
    action = { type: "command", name: String(raw.name).toLowerCase() };
  } else if (t === "wait") {
    action = { type: "wait", ms: parseInt(raw.ms, 10) || 0 };
  } else if (t === "timer") {
    const after = String(raw.after || raw.duration || raw.delay || "").trim();
    if (!after) return "error: timer action needs an 'after' duration like '5m'";
    action = { type: "timer", after: after };
    if (raw.run || raw.macro) action.run = String(raw.run || raw.macro).toLowerCase();
  } else if (t === "check" || t === "tool" || t === "action") {
    const tool = raw.tool || raw.name;
    if (!tool) return "error: check action needs a tool name";
    action = { type: "check", tool: String(tool), args: raw.args && typeof raw.args === "object" ? raw.args : {} };
    if (raw.path) action.path = String(raw.path);
  } else if (plugins.actions[t]) {
    const pa = plugins.actions[t];
    if (pa.fromAgent) {
      const result = pa.fromAgent(raw);
      if (typeof result === "string" && result.startsWith("error:")) return result;
      action = result;
    } else {
      action = { ...raw }; // no normalizer — trust the plugin's run()
    }
  } else {
    return "error: unknown action type '" + t + "'";
  }
  if (raw.when && !isEmptyObj(raw.when)) {
    const w = normalizeWhen(raw.when);
    if (typeof w === "string") return w; // validation error
    action.when = w;
  }
  return action;
}

function normalizeWhen(raw) {
  if (!raw || typeof raw !== "object") return "error: when must be an object";
  if (isEmptyObj(raw)) return null;
  const ops = ["eq", "ne", "contains", "not_contains", "matches", "gt", "lt", "exists", "truthy", "falsy", "not", "status"];
  const op = raw.op || "truthy";
  if (!ops.includes(op)) return "error: bad when op '" + op + "' (use: " + ops.join(", ") + ")";
  const w = { op };
  if (raw.arg != null) w.arg = String(raw.arg);
  else if (raw.tool) { w.tool = String(raw.tool); if (raw.args && typeof raw.args === "object") w.args = raw.args; if (raw.path) w.path = String(raw.path); }
  else if (raw.get) { w.get = String(raw.get); if (raw.method) w.method = String(raw.method).toUpperCase(); if (raw.path) w.path = String(raw.path); }
  else return "error: when needs one of: arg, tool, or get";
  if (raw.value !== undefined) w.value = raw.value;
  return w;
}

async function normalizeMacroActionInput(rawActions, label, forcedWhen) {
  if (rawActions == null) return [];
  if (!Array.isArray(rawActions)) return "error: " + label + " must be an array of actions";
  const clean = [];
  for (const raw of rawActions) {
    if (forcedWhen && raw && raw.when) return "error: " + label + " actions cannot include their own 'when'; use create_macro for nested conditions";
    const result = await normalizeActionList(raw);
    if (typeof result === "string") return result;
    for (const action of result) clean.push(forcedWhen ? { ...action, when: { ...forcedWhen } } : action);
  }
  return clean;
}

async function execTool(name, a) {
  switch (name) {
    case "list_macros": {
      const f = (a.filter || "").toLowerCase();
      return JSON.stringify(Object.entries(state.commands)
        .filter(([n]) => !f || n.toLowerCase().includes(f))
        .map(([n, c]) => ({ name: n, description: c.description || "", actions: c.actions.length })));
    }
    case "list_action_types": {
      const f = String(a.filter || "").toLowerCase();
      return JSON.stringify(macroActionCatalog().filter((x) =>
        !f || x.type.toLowerCase().includes(f) || String(x.source || "").toLowerCase().includes(f)
      ));
    }
    case "validate_macro_actions": {
      const actions = Array.isArray(a.actions) ? a.actions : [];
      if (!actions.length) return toolError(name, "actions must be a non-empty array");
      const clean = [];
      for (const raw of actions) {
        const result = await normalizeActionList(raw);
        if (typeof result === "string") return toolError(name, result.replace(/^error:\s*/, ""));
        clean.push(...result);
      }
      fillConditionArgs(clean);
      return JSON.stringify({ ok: true, actions: clean });
    }
    case "diagnose_macro": {
      const r = inspectMacro(a.name);
      return r.error ? toolError(name, r.error) : JSON.stringify(r);
    }
    case "list_apps": {
      const apps = await window.dum.listApps();
      const q = String(a.search || "").toLowerCase();
      return JSON.stringify(apps
        .filter((app) => !q || app.name.toLowerCase().includes(q))
        .slice(0, 30)
        .map((app) => ({ name: app.name, appId: app.appId })));
    }
    case "get_status": {
      const status = controlStatus();
      status.state = await gatherState();
      return JSON.stringify(status);
    }
    case "get_help": {
      const topic = String(a.topic || "agent").toLowerCase();
      const lines = builtInHelpLines(topic);
      if (lines) return JSON.stringify({ topic, lines });
      if (plugins.names.includes(topic)) return JSON.stringify({ topic, lines: plugins.help[topic] || [] });
      return toolError(name, "no help topic named '" + topic + "'. Try one of: " + helpTopicNames().slice(0, 16).join(", "));
    }
    case "control_api_status":
      return JSON.stringify(controlApiInfo());
    case "set_control_api_enabled": {
      state.config.apiEnabled = !!a.enabled;
      if (!state.config.controlToken) state.config.controlToken = genToken();
      if (state.config.apiPort == null) state.config.apiPort = 9876;
      await saveConfig();
      const r = await restartControlApi();
      if (r && r.ok === false) return "error: " + (r.error || "could not update control API");
      return JSON.stringify(controlApiInfo());
    }
    case "rotate_control_api_token": {
      state.config.controlToken = genToken();
      if (state.config.apiPort == null) state.config.apiPort = 9876;
      await saveConfig();
      const r = await restartControlApi();
      if (r && r.ok === false) return "error: " + (r.error || "could not restart control API");
      return JSON.stringify({ rotated: true, tokenShown: false, message: "new token generated; run the api command locally to view it", api: controlApiInfo() });
    }
    case "list_timers": {
      const timers = [];
      for (const [id, t] of activeTimers) timers.push(Object.assign({ id }, timerSummary(t)));
      return JSON.stringify({ timers });
    }
    case "cancel_timer": {
      const id = parseInt(a.id, 10);
      if (!id || !activeTimers.has(id)) return "error: no timer with id " + a.id + ". Hint: call list_timers first.";
      clearTimeout(activeTimers.get(id).timeout);
      activeTimers.delete(id);
      return "cancelled timer #" + id;
    }
    case "run_macro": {
      const key = String(a.name || "").toLowerCase();
      if (!state.commands[key]) return toolError(name, "no macro named '" + a.name + "'");
      await executeCommand(key, { args: a.args || [] });
      return "ran macro " + key;
    }
    case "preview_macro": {
      const key = String(a.name || "").toLowerCase();
      if (!state.commands[key]) return toolError(name, "no macro named '" + a.name + "'");
      await executeCommand(key, { args: a.args || [], dry: true });
      return "previewed macro " + key + " (dry run; no actions fired)";
    }
    case "create_macro": {
      const key = String(a.name || "").toLowerCase();
      if (!validName(key)) return toolError(name, "bad name (lowercase letters/digits/-/_ , max 30)");
      if (RESERVED.has(key)) return toolError(name, "'" + key + "' is a built-in command name");
      const actions = Array.isArray(a.actions) ? a.actions : [];
      if (!actions.length) return toolError(name, "a macro needs at least one action");
      const clean = [];
      for (const raw of actions) {
        const result = await normalizeActionList(raw);
        if (typeof result === "string") return toolError(name, result.replace(/^error:\s*/, "")); // validation error
        clean.push(...result);
      }
      fillConditionArgs(clean);
      const existed = !!state.commands[key];
      state.commands[key] = { description: a.description || "", actions: clean };
      await saveCommands();
      return (existed ? "updated" : "created") + " macro '" + key + "' with " + clean.length + " action(s); " + macroDiagnosisSummary(key);
    }
    case "create_branching_macro": {
      const key = String(a.name || "").toLowerCase();
      if (!validName(key)) return toolError(name, "bad name (lowercase letters/digits/-/_ , max 30)");
      if (RESERVED.has(key)) return toolError(name, "'" + key + "' is a built-in command name");
      const rawCondition = a.condition && typeof a.condition === "object" ? { ...a.condition, op: a.condition.op || "truthy" } : null;
      const ifWhen = normalizeWhen(rawCondition);
      if (typeof ifWhen === "string") return toolError(name, ifWhen.replace(/^error:\s*/, ""));
      if (ifWhen.op !== "truthy" && ifWhen.op !== "falsy") return toolError(name, "branch conditions currently use op 'truthy' or 'falsy' so Dumterm can build the opposite branch");
      const elseWhen = { ...ifWhen, op: ifWhen.op === "truthy" ? "falsy" : "truthy" };
      const before = await normalizeMacroActionInput(a.before_actions, "before_actions");
      if (typeof before === "string") return toolError(name, before.replace(/^error:\s*/, ""));
      const ifActions = await normalizeMacroActionInput(a.if_actions || a.then_actions, "if_actions", ifWhen);
      if (typeof ifActions === "string") return toolError(name, ifActions.replace(/^error:\s*/, ""));
      const elseActions = await normalizeMacroActionInput(a.else_actions || a.otherwise_actions, "else_actions", elseWhen);
      if (typeof elseActions === "string") return toolError(name, elseActions.replace(/^error:\s*/, ""));
      const after = await normalizeMacroActionInput(a.after_actions, "after_actions");
      if (typeof after === "string") return toolError(name, after.replace(/^error:\s*/, ""));
      const clean = before.concat(ifActions, elseActions, after);
      if (!clean.length) return toolError(name, "a macro needs at least one action");
      fillConditionArgs(clean);
      const existed = !!state.commands[key];
      state.commands[key] = { description: a.description || "", actions: clean };
      await saveCommands();
      return (existed ? "updated" : "created") + " branching macro '" + key + "' with " + clean.length + " action(s); " + macroDiagnosisSummary(key);
    }
    case "delete_macro": {
      const key = String(a.name || "").toLowerCase();
      if (!state.commands[key]) return toolError(name, "no macro named '" + a.name + "'");
      delete state.commands[key];
      await saveCommands();
      return "deleted macro " + key;
    }
    case "get_macro": {
      const key = String(a.name || "").toLowerCase();
      const c = state.commands[key];
      if (!c) return toolError(name, "no macro named '" + a.name + "'");
      return JSON.stringify({ name: key, description: c.description || "", actions: c.actions.map((x, i) => ({ index: i + 1, ...x })) });
    }
    case "add_macro_action": {
      const key = String(a.name || "").toLowerCase();
      const c = state.commands[key];
      if (!c) return toolError(name, "no macro named '" + a.name + "'");
      const norms = await normalizeActionList(a.action || {});
      if (typeof norms === "string") return toolError(name, norms.replace(/^error:\s*/, ""));
      const norm = norms[0];
      let pos = a.position != null ? parseInt(a.position, 10) - 1 : c.actions.length;
      if (isNaN(pos) || pos < 0) pos = 0;
      if (pos > c.actions.length) pos = c.actions.length;
      c.actions.splice(pos, 0, ...norms);
      await saveCommands();
      return "added " + norms.map((x) => x.type).join(", ") + " to '" + key + "' at step " + (pos + 1) + " (" + c.actions.length + " total); " + macroDiagnosisSummary(key);
    }
    case "remove_macro_action": {
      const key = String(a.name || "").toLowerCase();
      const c = state.commands[key];
      if (!c) return toolError(name, "no macro named '" + a.name + "'");
      const idx = parseInt(a.index, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= c.actions.length) return "error: step out of range (1.." + c.actions.length + ")";
      const removed = c.actions.splice(idx, 1)[0];
      await saveCommands();
      return "removed step " + (idx + 1) + " (" + removed.type + ") from '" + key + "'; " + macroDiagnosisSummary(key);
    }
    case "move_macro_action": {
      const key = String(a.name || "").toLowerCase();
      const c = state.commands[key];
      if (!c) return toolError(name, "no macro named '" + a.name + "'");
      const from = parseInt(a.from, 10) - 1, to = parseInt(a.to, 10) - 1;
      if ([from, to].some((n) => isNaN(n) || n < 0 || n >= c.actions.length)) return "error: step out of range (1.." + c.actions.length + ")";
      const [m] = c.actions.splice(from, 1);
      c.actions.splice(to, 0, m);
      await saveCommands();
      return "moved step " + (from + 1) + " → " + (to + 1) + " in '" + key + "'";
    }
    case "set_macro_description": {
      const key = String(a.name || "").toLowerCase();
      const c = state.commands[key];
      if (!c) return toolError(name, "no macro named '" + a.name + "'");
      c.description = String(a.description || "");
      await saveCommands();
      return "set description of '" + key + "'; " + macroDiagnosisSummary(key);
    }
    case "list_buttons": {
      return JSON.stringify(buttonSummary());
    }
    case "get_button": {
      const n = buttonRef(a.button);
      if (!n) return toolError(name, "button name must use letters, numbers, - or _");
      const s = slots()[n];
      if (!s) return toolError(name, "button " + n + " is not bound");
      return JSON.stringify({ button: n, name: s.name || s.action, action: s.action });
    }
    case "set_button": {
      const n = buttonRef(a.button || a.slot);
      if (!n) return "error: button name must use letters, numbers, - or _";
      const action = String(a.command || "").trim();
      if (!action) return "error: command required";
      const b = slots();
      b[n] = { action: action, name: a.name || (b[n] && b[n].name) || action };
      await saveConfig();
      return "button " + n + " → " + action + (b[n].name !== action ? " (\"" + b[n].name + "\")" : "");
    }
    case "label_button": {
      const n = buttonRef(a.button || a.slot);
      if (!n) return "error: button name must use letters, numbers, - or _";
      const b = slots();
      if (!b[n]) return "error: button " + n + " is not bound";
      const label = String(a.name || "").trim();
      if (!label) return "error: label required";
      b[n].name = label;
      await saveConfig();
      return "button " + n + " label → " + label;
    }
    case "clear_button": {
      const n = buttonRef(a.button || a.slot);
      if (!n) return "error: button name must use letters, numbers, - or _";
      const b = slots();
      if (!b[n]) return "button " + n + " was already empty";
      delete b[n];
      await saveConfig();
      return "button " + n + " cleared";
    }
    case "run_button": {
      const n = buttonRef(a.button || a.slot);
      const s = slots()[n];
      if (!n) return "error: button name must use letters, numbers, - or _";
      if (!s) return "error: button " + n + " is not bound";
      const r = await executeExternal(s.action);
      return r.ok ? "ran button " + n + " (" + s.action + ")" : r.error;
    }
    case "launch": {
      const target = await window.dum.resolveLaunch(a.target);
      const r = await window.dum.launch(target);
      return r.ok ? "launched " + a.target : "error launching: " + (r.error || "");
    }
    case "set_timer": {
      const ms = parseDuration(String(a.duration));
      if (ms == null) return "error: bad duration '" + a.duration + "'";
      const macro = a.macro ? a.macro.toLowerCase() : null;
      if (macro && !state.commands[macro]) return "error: no macro '" + a.macro + "'";
      const id = scheduleTimer(Date.now() + ms, macro, [], macro ? `timer → ${macro}` : `timer done (${a.duration})`, { kind: "timer", overlay: true });
      return `timer #${id} set for ${fmtRemaining(ms)}`;
    }
    case "set_alarm": {
      const when = parseClockLoose(String(a.time));
      if (!when) return "error: couldn't parse time '" + a.time + "' (try '9pm', '9:30pm', or '21:00')";
      const macro = a.macro ? a.macro.toLowerCase() : null;
      if (macro && !state.commands[macro]) return "error: no macro '" + a.macro + "'";
      const desc = macro ? `it's ${a.time} → running '${macro}'` : `alarm: ${a.time}`;
      const id = scheduleTimer(when.getTime(), macro, [], desc, { kind: "alarm", overlay: false });
      const tomorrow = when.getDate() !== new Date().getDate();
      return `alarm #${id} set for ${a.time}${tomorrow ? " tomorrow" : ""}${macro ? " → " + macro : ""}`;
    }
    case "http_request": {
      const r = await window.dum.httpRequest({ url: a.url, method: a.method, body: a.body });
      return r.ok ? `ok ${r.status}` : `error ${r.status}: ${truncate(r.body, 80)}`;
    }
    default:
      if (plugins.toolHandlers[name]) {
        try {
          const r = await plugins.toolHandlers[name](a);
          return typeof r === "string" ? r : JSON.stringify(r);
        } catch (err) {
          return "error: " + err.message;
        }
      }
      return "error: unknown tool " + name;
  }
}

function askConfirm(promptStr) {
  return new Promise((resolve) => {
    startPrompt(promptStr + A.dim(" [Y/n] "), (line) => {
      const v = line.trim().toLowerCase();
      resolve(v === "" || v === "y" || v === "yes");
    });
  });
}

async function gatherAgentContext() {
  let extra = "";
  for (const c of plugins.agentContext) {
    try {
      const s = await c.fn();
      if (s) extra += "\n\n" + String(s);
    } catch {}
  }
  return extra;
}

async function cmdDo(request, autoRun) {
  if (!state.config.lmstudioUrl) {
    println(A.red("no LM Studio URL set") + A.dim("  → config lmstudio.url http://your-mac:1234"));
    return showPrompt();
  }
  if (/^(reset|new|clear|forget)$/i.test((request || "").trim())) {
    state.agentThread = null;
    println(A.dim("· agent memory cleared"));
    return showPrompt();
  }
  if (!request) {
    println(A.dim("usage: do <plain-language request>   (do! skips confirm · do reset clears memory)"));
    return showPrompt();
  }
  // keep one rolling conversation so follow-ups ("now make them red") have context;
  // the system message (macro list + plugin context) is refreshed each turn.
  const sys = { role: "system", content: AGENT_SYSTEM + macroContext() + (await gatherAgentContext()) };
  if (!Array.isArray(state.agentThread)) state.agentThread = [];
  if (state.agentThread.length && state.agentThread[0].role === "system") state.agentThread[0] = sys;
  else state.agentThread.unshift(sys);
  const continuing = state.agentThread.length > 1;
  state.agentThread.push({ role: "user", content: request });
  if (continuing) println(A.dim("↳ continuing — `do reset` to start fresh"));
  return agentLoop(state.agentThread, autoRun, 0);
}

// keep the rolling thread within a local model's context: drop oldest turns at user-message
// boundaries (so assistant/tool-result pairs are never split), always keeping the system message.
function trimThread(thread, maxMsgs) {
  if (thread.length <= maxMsgs) return;
  const rest = thread.slice(1);
  let start = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].role === "user" && (rest.length - i) <= (maxMsgs - 1)) { start = i; break; }
  }
  const kept = [thread[0], ...rest.slice(start)];
  thread.length = 0;
  thread.push(...kept);
}

function buildAgentTools() {
  const tools = AGENT_TOOLS.concat(plugins.agentTools);
  const hints = Object.entries(plugins.actions)
    .filter(([, def]) => def.agentHint)
    .map(([type, def]) => "'" + type + "' — " + def.agentHint);
  return tools.map((t) => {
    if (t.function && t.function.name === "create_macro") {
      const clone = JSON.parse(JSON.stringify(t));
      clone.function.description += " For complex macros, call validate_macro_actions first. IMPORTANT: actions must be a flat array; do not nest actions like {spotify:{...}}. For conditions, put the check inline in each action's when object; do not add a separate tool/action step unless the user explicitly wants to display the check result. Correct IF/ELSE pattern: two actions with the same when.tool/args/path, one op 'truthy' and one op 'falsy'.";
      if (hints.length) clone.function.description += " Plugin action types also available: " + hints.join("; ") + ".";
      const props = clone.function.parameters.properties.actions.items.properties;
      if (props.type && Array.isArray(props.type.enum)) {
        props.type.enum = props.type.enum.concat(["check"], Object.keys(plugins.actions));
      }
      props.tool = { type: "string", description: "for check actions only; conditions use when.tool instead" };
      props.args = { type: "object", description: "tool arguments for check actions or when conditions" };
      props.path = { type: "string", description: "JSON path for check/when result, e.g. live" };
      props.value = { description: "plugin action value, such as brightness/color or start/stop/toggle" };
      return clone;
    }
    if (t.function && t.function.name === "add_macro_action") {
      const clone = JSON.parse(JSON.stringify(t));
      clone.function.description += " Use one flat action object. Put conditional checks inside action.when; do not nest actions under keys like {spotify:{...}}.";
      return clone;
    }
    if (t.function && t.function.name === "get_weather") {
      const clone = JSON.parse(JSON.stringify(t));
      clone.function.description += " If the user asks for the week, pass days: 7.";
      clone.function.parameters.properties.days = { type: "number", description: "forecast days, 4 by default or 7 for a week" };
      return clone;
    }
    return t;
  });
}

async function agentLoop(messages, autoRun, round) {
  if (round > 6) {
    println(A.red("✗ stopped — too many steps (possible loop)"));
    return showPrompt();
  }
  trimThread(messages, 28); // bound context for local models (mutates in place, keeps the state.agentThread ref)
  print(A.dim("· thinking "));
  const res = await window.dum.chatTools({
    url: state.config.lmstudioUrl,
    model: state.config.lmstudioModel,
    messages,
    tools: buildAgentTools(),
  });
  term.write("\r\x1b[K");

  if (!res.ok) {
    println(A.red("✗ " + res.error));
    return showPrompt();
  }
  const msg = res.message;
  if (!msg) {
    println(A.red("✗ empty response from model"));
    return showPrompt();
  }

  const calls = msg.tool_calls || [];
  if (msg.content && msg.content.trim()) {
    println(msg.content.trim().replace(/\n/g, "\r\n"));
  }
  if (!calls.length) {
    if (msg.content && msg.content.trim()) messages.push({ role: "assistant", content: msg.content }); // keep the reply for follow-ups
    return showPrompt(); // model is done
  }

  // parse args
  const parsed = calls.map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
    return { id: tc.id, name: tc.function.name, args };
  });

  // show the plan
  println(A.magenta("  proposes:"));
  for (const c of parsed) println("   • " + describeToolCall(c.name, c.args));

  const allSafe = parsed.every((c) => isSafeTool(c.name));
  const wantConfirm = state.config.agentConfirm !== false && !autoRun;
  if (wantConfirm && !allSafe) {
    const ok = await askConfirm("run this?");
    if (!ok) {
      println(A.yellow("  ⊘ skipped"));
      return showPrompt();
    }
  }

  // execute, collect results
  messages.push(msg);
  for (const c of parsed) {
    print(A.dim("   → " + c.name + " "));
    const result = await execTool(c.name, c.args);
    println(result.startsWith("error") ? A.red(result) : A.green("✓ ") + A.dim(truncate(result, 70)));
    messages.push({ role: "tool", tool_call_id: c.id, content: String(result) });
  }

  // loop back so the model can react to results / continue
  return agentLoop(messages, autoRun, round + 1);
}

// ---------- ask (LM Studio) ----------

function cmdAsk(question) {
  if (!state.config.lmstudioUrl) {
    println(A.red("no LM Studio URL set") + A.dim("  → config lmstudio.url http://your-mac:1234"));
    return showPrompt();
  }
  if (!question) {
    println(A.dim("usage: ask <question>"));
    return showPrompt();
  }
  const requestId = ++state.askCounter;
  let gotAnything = false;
  print(A.dim("· thinking "));
  const off = (msg) => {
    if (msg.requestId !== requestId) return;
    if (msg.type === "chunk") {
      if (!gotAnything) { term.write("\r\x1b[K"); gotAnything = true; }
      term.write(msg.data.replace(/\n/g, "\r\n"));
    } else if (msg.type === "done") {
      term.write("\r\n");
      showPrompt();
    } else if (msg.type === "error") {
      term.write("\r\x1b[K");
      println(A.red("✗ " + msg.data));
      showPrompt();
    }
  };
  window.dum.onAskChunk(off);
  window.dum.askStream({
    url: state.config.lmstudioUrl,
    model: state.config.lmstudioModel,
    prompt: question,
    requestId,
  });
}

// ============================================================
// create / edit wizard
// ============================================================

function validName(name) {
  return /^[a-z0-9][a-z0-9_-]{0,29}$/.test(name);
}

function cmdCreate(name) {
  if (!name) { println(A.dim("usage: create <name>")); return showPrompt(); }
  const key = name.toLowerCase();
  if (!validName(key)) { println(A.red("names: lowercase letters/digits/-/_ (max 30)")); return showPrompt(); }
  if (RESERVED.has(key)) { println(A.red(`'${key}' is a built-in`)); return showPrompt(); }
  if (state.commands[key]) { println(A.red(`'${key}' exists — use \`edit ${key}\` or \`delete ${key}\``)); return showPrompt(); }
  startWizard(key, { description: "", actions: [] }, false);
}

function cmdEdit(name) {
  if (!name) { println(A.dim("usage: edit <name>")); return showPrompt(); }
  const key = name.toLowerCase();
  if (!state.commands[key]) { println(A.red("no such command: " + name)); return showPrompt(); }
  const draft = JSON.parse(JSON.stringify(state.commands[key]));
  startWizard(key, draft, true);
}

function startWizard(name, draft, editing) {
  state.mode = "wizard";
  state.wizard = { name, draft, editing, step: "menu", pending: {} };
  println(A.dim(`building '${name}' — type an action number or drop a shortcut onto the window`));
  if (editing && draft.actions.length) {
    draft.actions.forEach((a, i) => println(A.dim(`  ${i + 1}. `) + describeAction(a)));
  }
  wizardMenu();
}

const WIZ = () => A.yellow(state.wizard.name + " ❯") + " ";

function pluginActionList() {
  // stable ordered list of [letter, type, def]
  const entries = Object.entries(plugins.actions);
  return entries.map(([type, def], i) => [String.fromCharCode(97 + i), type, def]); // a, b, c...
}

function wizardMenu() {
  let line = "[1] open app/url  [2] keystroke  [3] webhook  [4] run command  [5] wait";
  const pa = pluginActionList();
  if (pa.length) {
    line += "\r\n" + A.dim("  plugins: ") + pa.map(([ltr, , def]) => "[" + ltr + "] " + def.label).join("  ");
  }
  println(A.dim(line));
  println(A.dim("[7] describe  [8] remove  [9] save  [0] cancel  ·  [if] condition  ·  [timer] delayed macro"));
  state.wizard.step = "menu";
  startPrompt(WIZ(), wizardHandle);
}

function wizPrompt(step, hint) {
  if (hint) println(A.dim("  " + hint));
  state.wizard.step = step;
  startPrompt(WIZ(), wizardHandle);
}

// walk a plugin action's fields one at a time
function promptPluginField() {
  const p = state.wizard.pending;
  if (p.idx >= p.fields.length) {
    // done — validate via the plugin's fromAgent if present, else store raw
    const def = plugins.actions[p.actionType];
    let action = p.collected;
    if (def.fromAgent) {
      const result = def.fromAgent(p.collected);
      if (typeof result === "string" && result.startsWith("error:")) {
        println(A.red("  " + result));
        return wizardMenu();
      }
      action = result;
    }
    addAction(action);
    return wizardMenu();
  }
  const f = p.fields[p.idx];
  let hint = f.prompt || f.key;
  if (f.options) hint += " (" + f.options.join(" / ") + ")";
  if (f.optional) hint += " — optional, blank to skip";
  println(A.dim("  " + hint));
  state.wizard.step = "plugin-field";
  startPrompt(WIZ(), wizardHandle);
}

async function wizardHandle(line) {
  const w = state.wizard;
  if (!w) return showPrompt();
  const input = line.trim();

  switch (w.step) {
    case "menu": {
      const choiceArg = input.split(/\s+/);
      switch (choiceArg[0]) {
        case "1": {
          const search = choiceArg.slice(1).join(" ");
          if (search) return wizardAppSearch(search);
          return wizPrompt("open-target", "app name to search, full path, or a URL — or drop a shortcut · {1}/{*} ok in paths & urls");
        }
        case "2":
          return wizPrompt("key-keys", "SendKeys combo — ^=Ctrl +=Shift %=Alt, e.g. ^+{F13} for Ctrl+Shift+F13");
        case "3":
          return wizPrompt("hook-url", "webhook URL — {1}/{*} ok (e.g. .../webhook/{1})");
        case "4":
          return wizPrompt("chain-name", "command to chain: " + Object.keys(state.commands).filter((n) => n !== w.name).join(", "));
        case "5":
          return wizPrompt("wait-ms", "milliseconds to wait");
        case "7":
          return wizPrompt("describe", "one-line description");
        case "8":
          if (!w.draft.actions.length) { println(A.dim("  nothing to remove")); return wizardMenu(); }
          w.draft.actions.forEach((a, i) => println(A.dim(`  ${i + 1}. `) + describeAction(a)));
          return wizPrompt("remove-idx", "action number to remove");
        case "9": {
          if (!w.draft.actions.length) { println(A.red("  no actions yet — add at least one")); return wizardMenu(); }
          state.commands[w.name] = w.draft;
          await saveCommands();
          const diag = inspectMacro(w.name);
          println(A.green(`✓ saved '${w.name}' (${w.draft.actions.length} action${w.draft.actions.length === 1 ? "" : "s"})`));
          if (diag.ok && !diag.warnings.length) println(A.dim("  doctor: ok"));
          else {
            for (const issue of diag.issues) println("  " + A.red(issue));
            for (const warning of diag.warnings) println("  " + A.yellow(warning));
          }
          state.mode = "normal"; state.wizard = null;
          return showPrompt();
        }
        case "0": case "cancel":
          println(A.yellow("cancelled — nothing saved"));
          state.mode = "normal"; state.wizard = null;
          return showPrompt();
        case "if": case "cond": {
          if (!w.draft.actions.length) { println(A.dim("  no steps yet to condition")); return wizardMenu(); }
          w.draft.actions.forEach((a, i) => println(A.dim(`  ${i + 1}. `) + describeAction(a)));
          return wizPrompt("cond-step", "step number to gate with a condition");
        }
        case "timer": {
          return wizPrompt("timer-step", "delay then optional macro, e.g. `5m lights_off`  (just `5m` for a chime)");
        }
        default: {
          // plugin action letters (a, b, c…)?
          const pa = pluginActionList().find(([ltr]) => ltr === choiceArg[0].toLowerCase());
          if (pa) {
            const [, type, def] = pa;
            if (!def.fields || !def.fields.length) {
              // no fields to collect — add it directly
              addAction({ type });
              return wizardMenu();
            }
            w.pending = { actionType: type, fields: def.fields, idx: 0, collected: { type } };
            return promptPluginField();
          }
          println(A.dim("  pick a listed option"));
          return wizardMenu();
        }
      }
    }

    case "plugin-field": {
      const p = w.pending;
      const f = p.fields[p.idx];
      if (input || !f.optional) {
        if (f.options && input && f.options.indexOf(input.toLowerCase()) === -1) {
          println(A.red("  must be one of: " + f.options.join(", ")));
          return promptPluginField();
        }
        if (input) p.collected[f.key] = input;
        else if (!f.optional) {
          println(A.red("  required"));
          return promptPluginField();
        }
      }
      p.idx++;
      return promptPluginField();
    }

    case "open-target": {
      if (!input) return wizardMenu();
      if (/^https?:\/\//i.test(input) || input.includes("\\") || input.includes("/")) {
        addAction({ type: "open", target: input, label: input.split(/[\\/]/).pop() });
        return wizardMenu();
      }
      return wizardAppSearch(input);
    }

    case "app-pick": {
      const n = parseInt(input, 10);
      if (!n || n < 1 || n > w.pending.matches.length) {
        println(A.dim("  cancelled pick"));
        return wizardMenu();
      }
      const app = w.pending.matches[n - 1];
      addAction({ type: "open", target: "shell:AppsFolder\\" + app.appId, label: app.name });
      return wizardMenu();
    }

    case "key-keys": {
      if (!input) return wizardMenu();
      addAction({ type: "key", keys: input });
      return wizardMenu();
    }

    case "hook-url": {
      if (!input) return wizardMenu();
      w.pending.url = input;
      return wizPrompt("hook-method", "method [POST]: GET/POST/PUT — enter for POST");
    }
    case "hook-method": {
      w.pending.method = (input || "POST").toUpperCase();
      return wizPrompt("hook-body", "JSON body (optional, enter to skip) — {1}/{*} ok, e.g. {\"scene\":\"{1}\"}");
    }
    case "hook-body": {
      addAction({ type: "webhook", url: w.pending.url, method: w.pending.method, body: input || undefined });
      w.pending = {};
      return wizardMenu();
    }
    case "chain-name": {
      const key = input.toLowerCase();
      if (!state.commands[key]) { println(A.red("  no such command: " + input)); return wizardMenu(); }
      if (key === w.name) { println(A.red("  a command can't chain itself")); return wizardMenu(); }
      addAction({ type: "command", name: key });
      return wizardMenu();
    }

    case "wait-ms": {
      const ms = parseInt(input, 10);
      if (!ms || ms < 0) { println(A.dim("  cancelled")); return wizardMenu(); }
      addAction({ type: "wait", ms });
      return wizardMenu();
    }

    case "describe": {
      w.draft.description = input;
      println(A.dim("  description set"));
      return wizardMenu();
    }

    case "remove-idx": {
      const n = parseInt(input, 10);
      if (!n || n < 1 || n > w.draft.actions.length) { println(A.dim("  cancelled")); return wizardMenu(); }
      const removed = w.draft.actions.splice(n - 1, 1)[0];
      println(A.yellow("  − removed: ") + describeAction(removed));
      return wizardMenu();
    }

    case "timer-step": {
      const parts = input.split(/\s+/);
      const after = parts[0];
      if (!after || parseDuration(after) == null) { println(A.dim("  cancelled (need a duration like 5m)")); return wizardMenu(); }
      const run = parts[1] ? parts[1].toLowerCase() : null;
      if (run && !state.commands[run]) { println(A.red("  no such macro: " + parts[1])); return wizardMenu(); }
      addAction({ type: "timer", after: after, run: run || undefined });
      return wizardMenu();
    }
    case "cond-step": {
      const n = parseInt(input, 10);
      if (!n || n < 1 || n > w.draft.actions.length) { println(A.dim("  cancelled")); return wizardMenu(); }
      w.pending.condIdx = n - 1;
      return wizPrompt("cond-expr",
        "condition — e.g.  arg 1 eq red   ·   tool twitch_is_live streamer=ninja path=live truthy   ·   blank clears");
    }
    case "cond-expr": {
      const idx = w.pending.condIdx;
      if (idx == null || !w.draft.actions[idx]) return wizardMenu();
      if (!input) { delete w.draft.actions[idx].when; println(A.dim("  condition cleared")); return wizardMenu(); }
      const parsed = parseWhenExpr(input);
      if (typeof parsed === "string") { println(A.red("  " + parsed)); return wizardMenu(); }
      w.draft.actions[idx].when = parsed;
      println(A.dim("  → step " + (idx + 1) + " runs only if ") + describeWhen(parsed));
      return wizardMenu();
    }

    default:
      return wizardMenu();
  }
}

async function wizardAppSearch(search) {
  print(A.dim("  searching apps… "));
  const apps = await window.dum.listApps();
  term.write("\r\x1b[K");
  const matches = apps
    .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 9);
  if (!matches.length) {
    println(A.red("  no app matches '" + search + "'") + A.dim(" — paste a full path instead"));
    return wizardMenu();
  }
  if (matches.length === 1) {
    addAction({ type: "open", target: "shell:AppsFolder\\" + matches[0].appId, label: matches[0].name });
    return wizardMenu();
  }
  matches.forEach((a, i) => println(A.dim(`  [${i + 1}] `) + a.name));
  state.wizard.pending.matches = matches;
  return wizPrompt("app-pick", "pick a number (enter to cancel)");
}

function addAction(a) {
  const w = state.wizard;
  w.draft.actions.push(a);
  println(A.dim("  → added as action " + w.draft.actions.length + ": ") + describeAction(a));
}

// parse a compact wizard condition, e.g.  arg 1 eq red  ·  tool twitch_is_live streamer=ninja path=live truthy  ·  http <url> contains live
function parseWhenExpr(str) {
  const toks = tokenize(str);
  if (!toks.length) return "error: empty condition";
  const ops = ["eq", "ne", "contains", "not_contains", "matches", "gt", "lt", "exists", "truthy", "falsy", "not", "status"];
  const kind = toks[0].toLowerCase();
  if (kind === "arg") {
    const n = parseInt(toks[1], 10);
    if (!n) return "error: use:  arg <n> <op> <value>   e.g. arg 1 eq red";
    const op = (toks[2] || "exists").toLowerCase();
    const value = toks.slice(3).join(" ");
    return normalizeWhen({ arg: n, op, value: value || undefined });
  }
  if (kind === "tool") {
    const tname = toks[1];
    if (!tname) return "error: use:  tool <name> [k=v ...] [path=x] <op> <value>";
    let i = 2; const args = {}; let path;
    while (i < toks.length && toks[i].includes("=") && !ops.includes(toks[i].toLowerCase())) {
      const eq = toks[i].indexOf("=");
      const k = toks[i].slice(0, eq), v = toks[i].slice(eq + 1);
      if (k === "path") path = v; else args[k] = v;
      i++;
    }
    const op = (toks[i] || "truthy").toLowerCase(); i++;
    const value = toks.slice(i).join(" ");
    return normalizeWhen({ tool: tname, args: Object.keys(args).length ? args : undefined, path, op, value: value || undefined });
  }
  if (kind === "http" || kind === "get") {
    const url = toks[1];
    if (!url) return "error: use:  http <url> <op> <value>";
    const op = (toks[2] || "status").toLowerCase();
    const value = toks.slice(3).join(" ");
    return normalizeWhen({ get: url, op, value: value || undefined });
  }
  return "error: start with 'arg', 'tool', or 'http'";
}

// ============================================================
// drag & drop
// ============================================================

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dropping");
});
document.addEventListener("dragleave", () => document.body.classList.remove("dropping"));
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  for (const f of files) {
    const p = window.dum.pathForFile(f);
    if (!p) continue;
    const r = await window.dum.resolveShortcut(p);
    // interrupt whatever prompt is showing, print the capture, restore
    term.write("\r\x1b[K");
    if (state.mode === "wizard" && state.wizard) {
      addAction({ type: "open", target: r.target, label: r.name });
      if (["menu", "open-target"].includes(state.wizard.step)) {
        state.wizard.step = "menu";
        startPrompt(WIZ(), wizardHandle);
      } else {
        redrawLine();
      }
    } else {
      println(A.dim("⬇ dropped: ") + r.name + A.dim("  " + r.target));
      println(A.dim("  (drop during `create <name>` to add it to a macro)"));
      redrawLine();
    }
  }
});

// ============================================================
// boot
// ============================================================

// ============================================================
// named Stream Deck/dumterm buttons + local control API
// ============================================================

function slots() { state.config.buttons = state.config.buttons || {}; return state.config.buttons; }
function genToken() { try { return crypto.randomUUID().replace(/-/g, ""); } catch (e) { return (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, ""); } }
function validButtonSlot(n) { return /^[1-4]$/.test(String(n || "")); }
function buttonKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(key) ? key : null;
}
function buttonRef(value) {
  const key = buttonKey(value);
  return key || "";
}
function buttonSummary() {
  const b = slots();
  return Object.keys(b).sort((a, c) => a.localeCompare(c, undefined, { numeric: true })).map(function (n) {
    return { button: n, slot: validButtonSlot(n) ? n : null, bound: !!b[n], name: b[n] ? b[n].name : null, action: b[n] ? b[n].action : null };
  });
}

function cmdBind(args) {
  const n = buttonRef(args[0]);
  if (!n) return println(A.dim("usage: bind <button-name> <command...>   e.g. bind panic brb_mode"));
  const action = args.slice(1).join(" ").trim();
  if (!action) return println(A.dim("usage: bind <button-name> <command...>"));
  const b = slots();
  b[n] = { action: action, name: (b[n] && b[n].name) || action };
  saveConfig();
  println(A.green("button " + n + " -> ") + action + (b[n].name !== action ? A.dim("  (\"" + b[n].name + "\")") : ""));
}

function cmdLabel(args) {
  const n = buttonRef(args[0]);
  const b = slots();
  if (!n) return println(A.dim("usage: label <button-name> <display name...>"));
  if (!b[n]) return println(A.red("button " + n + " isn't bound - `bind " + n + " <command>` first"));
  b[n].name = args.slice(1).join(" ").trim() || b[n].action;
  saveConfig();
  println(A.green("button " + n + " label -> ") + b[n].name);
}

function cmdUnbind(args) {
  const n = buttonRef(args[0]);
  const b = slots();
  if (!n || !b[n]) return println(A.dim("usage: unbind <button-name>"));
  delete b[n];
  saveConfig();
  println(A.yellow("button " + n + " cleared"));
}

function cmdButtons(args) {
  const rows = buttonSummary();
  if (args && args.length) {
    const n = buttonRef(args[0]);
    if (!n) return println(A.dim("usage: buttons [button-name]"));
    const s = slots()[n];
    if (!s) return println(A.red("button " + n + " isn't bound - see `buttons`"));
    return println(A.green("  [" + n + "] ") + A.cyan(s.name || s.action) + A.dim("  -> " + s.action));
  }
  if (!rows.length) println(A.dim("  no buttons yet - try `bind panic brb_mode`"));
  for (const row of rows) {
    const n = row.button;
    const s = slots()[n];
    if (s) println(A.green("  [" + n + "] ") + A.cyan(s.name || s.action) + A.dim("  -> " + s.action));
  }
  println(A.dim("  bind <button> <command> | label <button> <name> | unbind <button> | button <button> runs it | `api` for Stream Deck"));
}

async function cmdButton(args) {
  const n = buttonRef(args[0]);
  const s = slots()[n];
  if (!n) return println(A.dim("usage: button <button-name>"));
  if (!s) return println(A.red("button " + n + " isn't bound - see `buttons`"));
  println(A.dim("button " + n + ": ") + s.action);
  await executeExternal(s.action + (args.length > 1 ? " " + args.slice(1).join(" ") : ""));
}

// run a command line triggered externally (a named button or the control API), tidying the prompt around it.
// interactive commands (wizard, ask, do, config…) are refused — the API is for fire-and-forget actions.
const EXTERNAL_BLOCK = new Set(["create", "edit", "ask", "do", "do!", "matrix", "exit", "quit", "clear", "help", "history", "config", "api", "bind", "unbind", "label", "button", "buttons"]);

async function executeExternal(line) {
  const tokens = tokenize(String(line || "").trim());
  if (!tokens.length) return { ok: false, error: "empty command" };
  const [cmd, ...args] = tokens;
  const lower = cmd.toLowerCase();
  if (EXTERNAL_BLOCK.has(lower)) return { ok: false, error: "'" + lower + "' can't run over the API" };
  const dry = args.includes("--dry");
  const cleanArgs = args.filter((a) => a !== "--dry");
  const wasActive = editor.active;
  if (wasActive) term.write("\r\x1b[K");
  let result = { ok: true, ran: line };
  try {
    if (state.commands[lower]) {
      await executeCommand(lower, { dry, args: cleanArgs });
    } else if (plugins.commands[lower]) {
      await plugins.commands[lower].run(cleanArgs);
    } else {
      switch (lower) {
        case "run": if (cleanArgs[0]) await executeCommand(cleanArgs[0].toLowerCase(), { dry, args: cleanArgs.slice(1) }); break;
        case "open": await cmdOpen(cleanArgs); break;
          case "timer": cmdTimer(cleanArgs); break;
        case "at": case "alarm": cmdAt(cleanArgs); break;
        case "cancel": cmdCancelTimer(cleanArgs[0]); break;
        case "theme": await cmdTheme(cleanArgs[0]); break;
        default: result = { ok: false, error: "unknown command: " + lower };
      }
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  if (wasActive) redrawLine();
  return result;
}

function controlStatus() {
  const timers = [];
  for (const [id, t] of activeTimers) timers.push(Object.assign({ id: id }, timerSummary(t)));
  const buttons = {};
  for (const n of Object.keys(slots()).sort((a, c) => a.localeCompare(c, undefined, { numeric: true }))) {
    const s = slots()[n];
    if (s) buttons[n] = { name: s.name || s.action, action: s.action };
  }
  const pluginStatus = {};
  for (const p of plugins.panels) { try { const out = p.render(); if (out) pluginStatus[p.plugin] = stripAnsi(String(out)); } catch (e) {} }
  return { macros: Object.keys(state.commands).length, timers: timers, buttons: buttons, plugins: pluginStatus };
}

function controlApiInfo() {
  const port = state.config.apiPort || 9876;
  return {
    enabled: state.config.apiEnabled === true,
    port: port,
    url: "http://127.0.0.1:" + port,
    hasToken: !!state.config.controlToken,
  };
}

function restartControlApi() {
  return window.dum.controlStart({ port: state.config.apiPort || 9876, token: state.config.controlToken, enabled: state.config.apiEnabled === true });
}

// structured state for the control API — each plugin owns its slice via ctx.registerState
async function gatherState() {
  const out = {};
  for (const p of plugins.stateProviders) {
    try { out[p.plugin] = await p.fn(); } catch (e) { out[p.plugin] = { error: String((e && e.message) || e) }; }
  }
  return out;
}

// dispatch a request from the control server (runs in the renderer, which holds the state)
async function handleControl(op, params) {
  params = params || {};
  try {
    switch (op) {
      case "button": {
        const n = buttonRef(params.n);
        if (!n) return { ok: false, error: "bad button name" };
        const s = slots()[n];
        if (!s || !s.action) return { ok: false, error: "button " + n + " is not bound" };
        const r = await executeExternal(s.action + (params.args && params.args.length ? " " + params.args.join(" ") : ""));
        return r.ok ? { ok: true, button: n, name: s.name || s.action, ran: s.action } : r;
      }
      case "run": {
        const key = String(params.macro || "").toLowerCase();
        if (!state.commands[key]) return { ok: false, error: "no macro '" + params.macro + "'" };
        const r = await executeExternal(key + (params.args && params.args.length ? " " + params.args.join(" ") : ""));
        return r.ok ? { ok: true, ran: key } : r;
      }
      case "command":
        return await executeExternal(String(params.line || ""));
      case "macros":
        return { ok: true, macros: Object.entries(state.commands).map(function (e) { return { name: e[0], description: e[1].description || "", actions: e[1].actions.length }; }) };
      case "buttons":
        return { ok: true, buttons: buttonSummary() };
      case "status": {
        const status = controlStatus();
        status.state = await gatherState();
        return { ok: true, status: status };
      }
      case "state":
        return { ok: true, state: { ...(await gatherState()), dumterm: { buttons: controlStatus().buttons } } };
      default:
        return { ok: false, error: "unknown op: " + op };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cmdApi(args) {
  const sub = (args[0] || "").toLowerCase();
  if (sub === "off") { state.config.apiEnabled = false; await saveConfig(); await window.dum.controlStart({ enabled: false }); return println(A.yellow("control API disabled")); }
  if (sub === "on") { state.config.apiEnabled = true; await saveConfig(); await restartControlApi(); println(A.green("control API enabled")); }
  if (sub === "newtoken" || sub === "regen") { state.config.controlToken = genToken(); await saveConfig(); await restartControlApi(); println(A.green("✓ new token — update your Stream Deck buttons")); }
  const on = state.config.apiEnabled === true;
  const port = state.config.apiPort || 9876;
  println(A.dim("control API   ") + (on ? A.green("on") : A.yellow("off")) + A.dim("   http://127.0.0.1:" + port));
  println(A.dim("token         ") + (state.config.controlToken || A.dim("(none)")));
  println("");
  println(A.dim("  Stream Deck → an HTTP-Request button:"));
  println(A.dim("    POST  http://127.0.0.1:" + port + "/button/panic"));
  println(A.dim("    header  X-Dumterm-Token: " + (state.config.controlToken || "")));
  println(A.dim("  endpoints: POST /button/<name> | POST /run/<macro> | POST /command {\"command\":\"...\"} | GET /buttons | GET /macros | GET /status"));
  println(A.dim("  toggle: api on · api off   ·   rotate: api newtoken"));
}

// core timer overlay (top-left): live countdowns for active non-alarm timers
function renderTimerPanel() {
  if (!activeTimers.size) return "";
  const lines = [];
  for (const t of activeTimers.values()) {
    if (t.overlay === false || t.kind === "alarm") continue;
    lines.push(A.yellow("⏱ ") + fmtRemaining(t.fireAt - Date.now()).padEnd(8) + A.dim(t.macro ? "→ " + t.macro : truncate(t.desc, 18)));
  }
  return lines.join("\n");
}

async function boot() {
  await loadStore();
  installDockResizer();
  try { if (Notification.permission === "default") Notification.requestPermission(); } catch {}
  println(A.green("dumterm") + A.dim(" v0.9 — a terminal that runs your macros, not your shell"));
  println(A.dim(sparkleLine(52)));
  println(A.dim("type `help` to get oriented · Ctrl+` toggles this window"));
  try { await loadPlugins(); } catch (e) { println(A.red("plugin load error: " + e.message)); }
  try { plugins.panels.push({ id: "timers", plugin: "timers", corner: "top-left", render: renderTimerPanel }); } catch (e) {}
  try { startPanels(); } catch (e) { /* never block the prompt */ }
  try {
    if (!state.config.controlToken) state.config.controlToken = genToken();
    if (state.config.apiPort == null) state.config.apiPort = 9876;
    await saveConfig();
    window.dum.onControlRequest(async function (msg) {
      const result = await handleControl(msg.op, msg.params);
      window.dum.controlRespond(msg.id, result);
    });
    window.dum.onControlError(function (m) { interject(function () { println(A.red("control API error: " + m)); }); });
    await window.dum.controlStart({ port: state.config.apiPort, token: state.config.controlToken, enabled: state.config.apiEnabled === true });
    if (state.config.apiEnabled === true) println(A.dim("control API on :" + state.config.apiPort + " — `api` for the token & Stream Deck setup"));
    else println(A.dim("control API off — `api on` to enable it (for Stream Deck / external control)"));
  } catch (e) { /* never block the prompt */ }
  println("");
  showPrompt();
}

boot().catch((e) => {
  try { println("\r\n" + A.red("boot error: " + (e && e.message))); showPrompt(); } catch {}
});
