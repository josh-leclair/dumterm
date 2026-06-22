// Markdown plugin for dumterm — create, view, edit, and manage markdown docs
// straight from the terminal. Runs capability-isolated (only `ctx`).
//
// Storage note: document bodies are real .md files in Documents/Dumterm Markdown.
// persisted through ctx.config — the only durable store reachable in-sandbox.
// EVERY read/write goes through the `store` object below, which delegates to
// the host's constrained Markdown file capability.
//
// Setup: nothing required. `md new notes` to start.

const A = ctx.ansi;

// degrade gracefully if a given ansi style isn't present on this build
function sty(name, s) {
  return (A && typeof A[name] === "function") ? A[name](s) : String(s);
}

// ---------- storage (real .md files + a lightweight display-name index) ----
// config stores native values (arrays/objects/strings), like streamwatch's
// watched list — no JSON wrapping. get() is sync; set() returns a promise.
//   index : array of { name, slug, created, modified, bytes }
//   body  : one config key per doc, "body:<slug>"  (a plain string)
const IDX_KEY = "index";
const BODY_PREFIX = "body:";

const store = {
  docs: [],
  bodies: {},
  ready: null,
  directory: null,
  ensure: function () {
    if (this.ready) return this.ready;
    const self = this;
    this.ready = (async function () {
      const legacy = Array.isArray(ctx.config.get(IDX_KEY)) ? ctx.config.get(IDX_KEY) : [];
      let disk = await ctx.markdown.list();
      const present = new Set(disk.map(function (d) { return d.slug; }));
      // Import earlier config-only documents into actual .md files exactly once.
      for (const doc of legacy) {
        const slug = slugify(doc && doc.slug || doc && doc.name);
        if (!present.has(slug)) {
          const body = ctx.config.get(BODY_PREFIX + slug);
          await ctx.markdown.write(slug + ".md", body == null ? "" : String(body));
        }
      }
      disk = await ctx.markdown.list();
      const legacyBySlug = {};
      legacy.forEach(function (doc) { if (doc && doc.slug) legacyBySlug[doc.slug] = doc; });
      self.docs = disk.map(function (file) {
        const old = legacyBySlug[file.slug] || {};
        return {
          name: old.name || file.slug,
          slug: file.slug,
          created: old.created || file.modified,
          modified: file.modified,
          bytes: file.bytes,
        };
      });
      self.bodies = {};
      for (const file of disk) {
        const read = await ctx.markdown.read(file.file);
        self.bodies[file.slug] = read.content;
      }
      self.directory = await ctx.markdown.root();
      await ctx.config.set(IDX_KEY, self.docs);
      // Text is no longer stored in config. Keep only the lightweight index for
      // friendly display names and migration history.
      for (const doc of legacy) if (doc && doc.slug) await ctx.config.set(BODY_PREFIX + doc.slug, null);
      return self.docs;
    })().catch(function (err) { self.ready = null; throw err; });
    return this.ready;
  },
  reload: function () { this.ready = null; return this.ensure(); },
  index: function () { return this.docs; },
  saveIndex: async function (idx) { this.docs = idx; await ctx.config.set(IDX_KEY, idx); },
  body: function (slug) { return this.bodies[slug] == null ? "" : String(this.bodies[slug]); },
  saveBody: async function (slug, text) {
    const next = String(text == null ? "" : text);
    await ctx.markdown.write(slug + ".md", next);
    this.bodies[slug] = next;
  },
  dropBody: async function (slug) {
    await ctx.markdown.remove(slug + ".md");
    delete this.bodies[slug];
  },
  renameBody: async function (fromSlug, toSlug) {
    await ctx.markdown.rename(fromSlug + ".md", toSlug + ".md");
    this.bodies[toSlug] = this.body(fromSlug);
    delete this.bodies[fromSlug];
  },
};

// ---------- helpers --------------------------------------------------------
function slugify(name) {
  return String(name || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";
}
function nowISO() { return new Date().toISOString(); }

// allow literal \n typed on the command line to become real newlines
function normalizeBody(s) { return String(s == null ? "" : s).replace(/\\n/g, "\n"); }

async function touch(slug, bytes) {
  return store.saveIndex(store.index().map(function (d) {
    return d.slug === slug ? Object.assign({}, d, { modified: nowISO(), bytes: bytes }) : d;
  }));
}

// structured event bus — shape matches streamwatch: { type, title, detail, data }
function emit(type, title, detail, data) {
  try {
    if (ctx.events && typeof ctx.events.emit === "function") {
      ctx.events.emit({ type: type, title: title, detail: detail || "", data: data || {} });
    }
  } catch (e) { /* events are best-effort */ }
}

// exact slug -> exact name -> name substring -> slug substring (govee-style loose match)
function resolve(ref) {
  const idx = store.index();
  const n = String(ref || "").toLowerCase().trim();
  if (!n) throw new Error("which doc? try `md ls`");
  const s = slugify(ref);
  let hit = idx.find(function (d) { return d.slug === s; });
  if (!hit) hit = idx.find(function (d) { return d.name.toLowerCase() === n; });
  if (!hit) hit = idx.find(function (d) { return d.name.toLowerCase().indexOf(n) !== -1; });
  if (!hit) hit = idx.find(function (d) { return d.slug.indexOf(s) !== -1; });
  if (!hit) throw new Error("no doc matching '" + ref + "' — see `md ls`");
  return hit;
}

// ---------- core CRUD (the real implementations) ---------------------------
function listDocNames() { return store.index().map(function (d) { return d.name; }); }

async function createDoc(name, body) {
  const display = String(name || "").trim();
  if (!display) throw new Error("a name is required");
  const slug = slugify(display);
  const idx = store.index();
  if (idx.some(function (d) { return d.slug === slug; })) {
    throw new Error("'" + display + "' already exists — use `md add` or `md set`");
  }
  const text = normalizeBody(body || "");
  const entry = { name: display, slug: slug, created: nowISO(), modified: nowISO(), bytes: text.length };
  idx.push(entry);
  await store.saveBody(slug, text);
  await store.saveIndex(idx);
  emit("markdown.doc.created", display + " created", slug + ".md", { name: display, slug: slug });
  return entry;
}

function readDoc(ref) { const d = resolve(ref); return { entry: d, body: store.body(d.slug) }; }

async function appendDoc(ref, body) {
  const d = resolve(ref);
  const add = normalizeBody(body || "");
  const cur = store.body(d.slug);
  const next = (cur && cur.charAt(cur.length - 1) !== "\n") ? cur + "\n" + add : cur + add;
  await store.saveBody(d.slug, next);
  await touch(d.slug, next.length);
  emit("markdown.doc.edited", d.name + " edited", "append", { name: d.name, slug: d.slug, op: "append" });
  return d;
}

async function writeDoc(ref, body) {
  const d = resolve(ref);
  const text = normalizeBody(body || "");
  await store.saveBody(d.slug, text);
  await touch(d.slug, text.length);
  emit("markdown.doc.edited", d.name + " edited", "write", { name: d.name, slug: d.slug, op: "write" });
  return d;
}

async function deleteDoc(ref) {
  const d = resolve(ref);
  await store.dropBody(d.slug);
  await store.saveIndex(store.index().filter(function (x) { return x.slug !== d.slug; }));
  emit("markdown.doc.deleted", d.name + " deleted", "", { name: d.name, slug: d.slug });
  return d;
}

async function renameDoc(ref, newName) {
  const d = resolve(ref);
  const display = String(newName || "").trim();
  if (!display) throw new Error("new name is required");
  const newSlug = slugify(display);
  const idx = store.index();
  if (newSlug !== d.slug && idx.some(function (x) { return x.slug === newSlug; })) {
    throw new Error("'" + display + "' already exists");
  }
  if (newSlug !== d.slug) await store.renameBody(d.slug, newSlug);
  await store.saveIndex(idx.map(function (x) {
    return x.slug === d.slug ? Object.assign({}, x, { name: display, slug: newSlug, modified: nowISO() }) : x;
  }));
  emit("markdown.doc.renamed", display + " renamed", d.name, { name: display, slug: newSlug, from: d.name });
  return { name: display, slug: newSlug };
}

async function removeLine(ref, lineNo) {
  const d = resolve(ref);
  const n = parseInt(lineNo, 10);
  if (isNaN(n) || n < 1) throw new Error("line number must be 1 or greater");
  const lines = store.body(d.slug).split("\n");
  if (n > lines.length) throw new Error("doc only has " + lines.length + " line(s)");
  const removed = lines.splice(n - 1, 1);
  const next = lines.join("\n");
  await store.saveBody(d.slug, next);
  await touch(d.slug, next.length);
  emit("markdown.doc.edited", d.name + " edited", "rmline", { name: d.name, slug: d.slug, op: "rmline" });
  return removed[0];
}

// ---------- markdown -> ANSI renderer (terminal `view`) --------------------
function inline(s) {
  s = String(s == null ? "" : s);
  s = s.replace(/`([^`]+)`/g, function (m, p1) { return sty("yellow", p1); });   // code
  s = s.replace(/\*\*([^*]+)\*\*/g, function (m, p1) { return sty("bold", p1); }); // **bold**
  s = s.replace(/__([^_]+)__/g, function (m, p1) { return sty("bold", p1); });     // __bold__
  s = s.replace(/\*([^*]+)\*/g, function (m, p1) { return sty("italic", p1); });   // *italic*
  s = s.replace(/_([^_]+)_/g, function (m, p1) { return sty("italic", p1); });     // _italic_
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, t, u) { return sty("cyan", t) + sty("dim", " (" + u + ")"); });
  return s;
}

function renderMarkdown(md) {
  const lines = String(md || "").split("\n");
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) { inFence = !inFence; out.push(sty("dim", inFence ? "┌─ " + (fence[1] || "code") : "└─")); continue; }
    if (inFence) { out.push(sty("green", "  " + line)); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push(sty("dim", new Array(41).join("─"))); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const txt = inline(h[2]);
      if (h[1].length === 1) out.push(sty("bold", sty("cyan", txt)));
      else if (h[1].length === 2) out.push(sty("bold", txt));
      else out.push(sty("bold", sty("dim", txt)));
      continue;
    }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { out.push(sty("dim", "│ " + inline(q[1]))); continue; }

    const task = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      const done = task[2].toLowerCase() === "x";
      out.push(task[1] + (done ? sty("green", "[x]") : "[ ]") + " " + (done ? sty("dim", inline(task[3])) : inline(task[3])));
      continue;
    }

    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) { out.push(ul[1] + sty("cyan", "•") + " " + inline(ul[2])); continue; }

    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) { out.push(ol[1] + sty("cyan", ol[2] + ".") + " " + inline(ol[3])); continue; }

    out.push(inline(line));
  }
  return out.join("\n");
}

// ---------- terminal presentation ------------------------------------------
function printView(ref) {
  const r = readDoc(ref);
  ctx.println(sty("cyan", "# " + r.entry.name) + sty("dim", "  " + r.entry.slug + ".md"));
  ctx.println(sty("dim", new Array(33).join("─")));
  if (!r.body) return ctx.println(sty("dim", "(empty — `md add " + r.entry.slug + " <text>`)"));
  ctx.println(renderMarkdown(r.body));
}

function printList() {
  const idx = store.index();
  if (!idx.length) return ctx.println(sty("dim", "no documents yet — `md new <name>` to start"));
  ctx.println(sty("green", "markdown docs") + sty("dim", "  (" + idx.length + ")"));
  idx.slice().sort(function (a, b) { return String(b.modified).localeCompare(String(a.modified)); })
     .forEach(function (d) { ctx.println("  " + d.name + sty("dim", "  " + d.slug + "  " + (d.bytes || 0) + "b")); });
}

// "name :: body"  OR  "<first-token-name> rest is body"
function splitNameBody(args) {
  const joined = args.join(" ");
  const sep = joined.indexOf("::");
  if (sep !== -1) return { name: joined.slice(0, sep).trim(), body: joined.slice(sep + 2).trim() };
  return { name: args[0] || "", body: args.slice(1).join(" ") };
}

// ---------- terminal command -----------------------------------------------
ctx.registerCommand("md", {
  description: "markdown docs: new · view · edit · cat · add · set · ls · rm",
  run: async function (args) {
    await store.ensure();
    const op = (args[0] || "ls").toLowerCase();
    const rest = args.slice(1);
    try {
      if (op === "ls" || op === "list" || op === "docs") return printList();
      if (op === "refresh" || op === "reload") { await store.reload(); return ctx.println(sty("green", "✓ refreshed markdown files")); }
      if (op === "folder" || op === "path") return ctx.println(store.directory || A.dim("markdown folder is unavailable"));
      if (op === "new" || op === "create") {
        const nb = splitNameBody(rest);
        const e = await createDoc(nb.name, nb.body);
        return ctx.println(sty("green", "✓ created ") + e.name + sty("dim", "  (" + e.slug + ")"));
      }
      if (op === "view" || op === "read" || op === "show") return printView(rest.join(" "));
      if (op === "cat" || op === "raw") { const r = readDoc(rest.join(" ")); return ctx.println(r.body || sty("dim", "(empty)")); }
      if (op === "edit") {
        const ref = rest.join(" ").trim();
        if (!ref) throw new Error("which doc? `md edit <name>`");
        let entry = null, body = "";
        try { const r = readDoc(ref); entry = r.entry; body = r.body; } catch (e) { entry = null; }
        const edited = await ctx.editText({ title: (entry ? entry.name : ref) + ".md", text: body });
        if (edited == null) return ctx.println(sty("dim", "edit cancelled — nothing saved"));
        if (entry) {
          if (edited === body) return ctx.println(sty("dim", "no changes"));
          await writeDoc(entry.slug, edited);
          return ctx.println(sty("green", "✓ saved ") + entry.name);
        }
        const created = await createDoc(ref, edited);
        return ctx.println(sty("green", "✓ created ") + created.name);
      }
      if (op === "add" || op === "append") {
        const nb = splitNameBody(rest);
        if (!nb.body) throw new Error("nothing to add — `md add <name> <text>`");
        const d = await appendDoc(nb.name, nb.body);
        return ctx.println(sty("green", "✓ ") + "appended to " + d.name);
      }
      if (op === "set" || op === "write") {
        const nb = splitNameBody(rest);
        const d = await writeDoc(nb.name, nb.body);
        return ctx.println(sty("green", "✓ ") + "rewrote " + d.name);
      }
      if (op === "rmline") {
        const n = rest.pop();
        const removed = await removeLine(rest.join(" "), n);
        return ctx.println(sty("green", "✓ ") + "removed line: " + sty("dim", removed));
      }
      if (op === "rename" || op === "mv") {
        const parts = rest.join(" ").split("->");
        if (parts.length !== 2) throw new Error("usage: md rename <old> -> <new>");
        const res = await renameDoc(parts[0].trim(), parts[1].trim());
        return ctx.println(sty("green", "✓ ") + "renamed to " + res.name);
      }
      if (op === "rm" || op === "delete" || op === "del") {
        const d = await deleteDoc(rest.join(" "));
        return ctx.println(sty("green", "✓ ") + "deleted " + d.name);
      }
      ctx.println(sty("dim", "usage: md ls | refresh | folder | new <name> | view <name> | edit <name> | cat <name> | add <name> <text> | set <name> <text> | rmline <name> <n> | rename <old> -> <new> | rm <name>"));
    } catch (e) { ctx.println(sty("red", "✗ " + e.message)); }
  },
});

ctx.registerHelp([
  sty("cyan", "md ls") + "                     list your markdown docs",
  sty("cyan", "md refresh") + "                reload files edited outside Dumterm",
  sty("cyan", "md folder") + "                 show the real .md files folder",
  sty("cyan", "md new <name>") + "             create a doc (add `:: text` for initial content)",
  sty("cyan", "md view <name>") + "            render a doc in the terminal",
  sty("cyan", "md edit <name>") + "            open the inline editor (^S save · ^Q quit)",
  sty("cyan", "md cat <name>") + "             print the raw markdown",
  sty("cyan", "md add <name> <text>") + "      append a line (use \\n for several)",
  sty("cyan", "md set <name> <text>") + "      replace the whole doc body",
  sty("cyan", "md rmline <name> <n>") + "      delete line n",
  sty("cyan", "md rename <old> -> <new>") + "  rename a doc",
  sty("cyan", "md rm <name>") + "              delete a doc",
  "",
  sty("dim", "names match loosely: `md view groc` opens 'groceries'"),
  sty("dim", "use `name :: body` when a name has spaces: md add meeting notes :: discussed roadmap"),
]);

// tab completion: subcommands first, then doc names
ctx.registerCompletion("md", function (args) {
  if (args.length <= 1) return ["ls", "refresh", "folder", "new", "view", "edit", "cat", "add", "set", "rmline", "rename", "rm"];
  return store.index().map(function (d) { return d.name; });
});

// ---------- shared operation: macros + manual wizard + local-model tools ----
ctx.registerOperation({
  id: "markdown.doc",
  description: "Create, read, append to, overwrite, or delete a markdown document.",
  run: async function (input) {
    await store.ensure();
    const op = String(input && input.op || "").toLowerCase();
    const name = input && (input.name || input.target);
    const content = input && input.content;
    if (op === "create") return "created " + (await createDoc(name, content)).name;
    if (op === "read") return readDoc(name).body;
    if (op === "append") return "appended to " + (await appendDoc(name, content)).name;
    if (op === "write") return "rewrote " + (await writeDoc(name, content)).name;
    if (op === "delete") return "deleted " + (await deleteDoc(name)).name;
    if (op === "list") { const ns = listDocNames(); return ns.length ? ns.join("\n") : "(no documents)"; }
    throw new Error("unknown markdown op: " + op);
  },
  action: {
    type: "markdown",
    describe: function (a) { return "md " + a.op + " " + (a.name || "") + (a.content ? " :: " + String(a.content).slice(0, 40) : ""); },
    toInput: function (a) { return { op: a.op, name: a.name, content: a.content }; },
    agentHint: 'create/read/edit a markdown doc. Fields: {"type":"markdown","op":"create|read|append|write|delete","name":"<doc name>","content":"<text, for create/append/write>"}. content is omitted for read/delete.',
    fromAgent: function (raw) {
      const op = String(raw.op || "").toLowerCase();
      const name = raw.name || raw.target;
      if (!name) return "error: markdown action needs a doc name";
      if (["create", "read", "append", "write", "delete"].indexOf(op) === -1) return "error: markdown op must be create, read, append, write, or delete";
      if ((op === "create" || op === "append" || op === "write") && raw.content == null) return "error: markdown " + op + " needs content";
      return { type: "markdown", op: op, name: name, content: raw.content };
    },
    label: "markdown doc",
    fields: [
      { key: "op", prompt: "operation", options: ["create", "read", "append", "write", "delete"] },
      { key: "name", prompt: "doc name (exact or partial)" },
      { key: "content", prompt: "content (for create/append/write)", optional: true },
    ],
  },
  // Live agent tools are non-destructive (no delete here). Deletion stays on
  // the deliberate surfaces: terminal command, macro authoring, manual wizard.
  tools: [
    {
      schema: { type: "function", function: { name: "md_create", description: "Create a new markdown document. Fails if a doc with that name already exists. Provide the full markdown body in `content` (may be empty).", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name"] } } },
      toInput: function (a) { return { op: "create", name: a.name, content: a.content || "" }; },
    },
    {
      schema: { type: "function", function: { name: "md_read", description: "Return the raw markdown body of one document. Use an exact or partial name from the doc list in the system prompt.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
      toInput: function (a) { return { op: "read", name: a.name }; },
    },
    {
      schema: { type: "function", function: { name: "md_append", description: "Append text to the end of an existing markdown document (a newline is inserted first if needed).", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } } },
      toInput: function (a) { return { op: "append", name: a.name, content: a.content }; },
    },
    {
      schema: { type: "function", function: { name: "md_write", description: "Replace the entire body of an existing markdown document with new content.", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } } },
      toInput: function (a) { return { op: "write", name: a.name, content: a.content }; },
    },
  ],
});

// ---------- structured state for the control API ---------------------------
ctx.registerState(async function () {
  await store.ensure();
  const idx = store.index();
  return {
    count: idx.length,
    docs: idx.map(function (d) { return { name: d.name, slug: d.slug, bytes: d.bytes || 0, modified: d.modified }; }),
  };
});

// ---------- agent context: hand doc names to the LLM up front --------------
ctx.registerAgentContext(async function () {
  try {
    await store.ensure();
    const names = listDocNames();
    if (!names.length) return "The user has no markdown documents yet. Use md_create to start one.";
    return "The user's markdown documents are named: " +
      names.map(function (n) { return '"' + n + '"'; }).join(", ") +
      ". When calling markdown tools, pass one of these names (partial matches also work).";
  } catch (e) { return ""; }
});

// ---------- standalone discovery tool --------------------------------------
ctx.registerAgentTool(
  { type: "function", function: { name: "md_list_docs", description: "List the user's markdown documents with names and metadata (slug, byte size, timestamps).", parameters: { type: "object", properties: {} } } },
  async function () { await store.ensure(); return JSON.stringify(store.index()); }
);
