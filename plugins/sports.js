// Sports plugin for dumterm — ESPN's public (unofficial) JSON endpoints. No key.
// `score <team>`      latest/live score (or next game if not playing today)
// `schedule <team>`   upcoming games
// Covers MLB, NBA, NFL. Names resolve across leagues: `score dodgers` just works.
// Disambiguate collisions (e.g. Cardinals) with a league prefix: `score nfl cardinals`.
//
// These endpoints are undocumented and can change without notice.

const A = ctx.ansi;
const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const LEAGUES = [
  { key: "mlb", sport: "baseball", league: "mlb" },
  { key: "nba", sport: "basketball", league: "nba" },
  { key: "nfl", sport: "football", league: "nfl" },
];

let teamIndex = null;

async function getJson(url) {
  const r = await ctx.http({ url: url, method: "GET" });
  if (!r.ok) throw new Error("http " + r.status);
  const body = r.body || "";
  try { return JSON.parse(body); }
  catch (e) {
    // surface what actually came back instead of a vague size number
    const head = body.slice(0, 60).replace(/\n/g, " ");
    throw new Error("unparseable (" + body.length + " chars, starts: '" + head + "')");
  }
}

async function loadTeams() {
  if (teamIndex) return teamIndex;
  teamIndex = [];
  for (const L of LEAGUES) {
    try {
      const d = await getJson(BASE + "/" + L.sport + "/" + L.league + "/teams");
      const teams = (((d.sports || [])[0] || {}).leagues || [])[0];
      const list = (teams && teams.teams) || [];
      for (const t of list) {
        const tm = t.team || {};
        teamIndex.push({
          league: L.league, sport: L.sport, id: tm.id,
          abbrev: (tm.abbreviation || "").toLowerCase(),
          nickname: (tm.name || tm.nickname || "").toLowerCase(),
          display: tm.displayName || tm.name || tm.abbreviation,
          search: [tm.displayName, tm.abbreviation, tm.name, tm.nickname, tm.location].filter(Boolean).join(" ").toLowerCase(),
        });
      }
    } catch (e) { /* skip a league that fails */ }
  }
  return teamIndex;
}

async function resolve(query, leagueHint) {
  const idx = await loadTeams();
  const pool = leagueHint ? idx.filter(function (t) { return t.league === leagueHint; }) : idx;
  const q = query.toLowerCase().trim();
  if (!q) throw new Error("which team?");
  let hits = pool.filter(function (t) { return t.abbrev === q || t.nickname === q; });
  if (!hits.length) hits = pool.filter(function (t) { return t.search.indexOf(q) !== -1; });
  if (!hits.length) throw new Error("no team matching '" + query + "'");
  return hits;
}

function teamUrl(t) { return BASE + "/" + t.sport + "/" + t.league + "/teams/" + t.id; }
function scoreboardUrl(t) { return BASE + "/" + t.sport + "/" + t.league + "/scoreboard"; }

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// local clock time only (e.g. "9:10 PM") — unambiguous value to pass to set_alarm
function fmtLocalTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusOf(ev) {
  const comp = (ev.competitions || [])[0] || {};
  return (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
}

function scoreOf(c) {
  const s = c.score;
  if (s == null) return "-";
  if (typeof s === "object") return s.displayValue != null ? s.displayValue : (s.value != null ? s.value : "-");
  return s;
}

function scoreLine(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const cs = comp.competitors || [];
  const home = cs.find(function (c) { return c.homeAway === "home"; }) || cs[0] || {};
  const away = cs.find(function (c) { return c.homeAway === "away"; }) || cs[1] || {};
  const ab = function (c) { return (c.team && (c.team.abbreviation || c.team.shortDisplayName)) || "?"; };
  const st = statusOf(ev);
  const name = (st.name || "").toUpperCase();
  const detail = st.shortDetail || st.description || "";
  const board = A.bold(ab(away) + " " + scoreOf(away)) + A.dim(" — ") + A.bold(scoreOf(home) + " " + ab(home));
  if (st.state === "pre") {
    return A.dim(ab(away) + " @ " + ab(home) + "   " + detail);
  }
  return board + "   " + A.cyan(detail || name);
}

// the scoreboard is small (today's games only) — match our team within it, like the bot does
async function findInScoreboard(team) {
  const sb = await getJson(scoreboardUrl(team));
  return (sb.events || []).find(function (e) {
    const comp = (e.competitions || [])[0] || {};
    return (comp.competitors || []).some(function (c) { return c.team && c.team.id === team.id; });
  });
}

// next game without pulling the whole season — the team endpoint carries nextEvent
async function nextEvent(team) {
  const d = await getJson(teamUrl(team));
  return ((d.team && d.team.nextEvent) || [])[0] || null;
}

async function doScore(team) {
  const ev = await findInScoreboard(team);
  if (ev) { ctx.println("  " + scoreLine(ev)); return; }
  const next = await nextEvent(team);
  if (next) {
    ctx.println(A.dim("  no game today — next:"));
    ctx.println("  " + A.cyan(fmtDate(next.date)) + "   " + (next.shortName || next.name || ""));
    return;
  }
  ctx.println(A.dim("  " + team.display + " — no game today, none scheduled"));
}

async function doSchedule(team, n) {
  const d = await getJson(teamUrl(team));
  const next = (d.team && d.team.nextEvent) || [];
  if (!next.length) { ctx.println(A.dim("  no upcoming games listed")); return; }
  ctx.println(A.green(team.display) + A.dim("  upcoming"));
  next.slice(0, n || 3).forEach(function (ev) {
    ctx.println("  " + A.cyan(fmtDate(ev.date)) + "   " + (ev.shortName || ev.name || ""));
  });
}

async function withTeam(args, fn) {
  let leagueHint = null;
  if (["mlb", "nba", "nfl"].indexOf((args[0] || "").toLowerCase()) !== -1) { leagueHint = args[0].toLowerCase(); args = args.slice(1); }
  const query = args.join(" ");
  const hits = await resolve(query, leagueHint);
  if (hits.length > 1) {
    ctx.println(A.dim("several matches — add a league: ") +
      hits.map(function (h) { return h.league + " " + query; }).join(" · "));
    return;
  }
  await fn(hits[0]);
}

ctx.safeTools(["sports_score", "sports_schedule"]);

ctx.registerCommand("score", {
  description: "latest/live score for a team (mlb/nba/nfl)",
  run: async function (args) {
    if ((args[0] || "").toLowerCase() === "debug") {
      try {
        const hits = await resolve(args.slice(1).join(" ") || "dodgers");
        const url = scoreboardUrl(hits[0]);
        ctx.println(A.dim("GET " + url));
        const r = await ctx.http({ url: url, method: "GET" });
        ctx.println(A.dim("status ") + r.status + A.dim("  size ") + String(r.body || "").length + A.dim(" chars"));
        ctx.println(A.dim("head: ") + String(r.body || "").slice(0, 80).replace(/\n/g, " "));
      } catch (e) { ctx.println(A.red("✗ " + e.message)); }
      return;
    }
    try { await withTeam(args, function (t) { return doScore(t); }); }
    catch (e) { ctx.println(A.red("✗ " + e.message)); }
  },
});

ctx.registerCommand("schedule", {
  description: "upcoming games for a team (mlb/nba/nfl)",
  run: async function (args) {
    try { await withTeam(args, function (t) { return doSchedule(t, 3, false); }); }
    catch (e) { ctx.println(A.red("✗ " + e.message)); }
  },
});

ctx.registerHelp([
  A.cyan("score <team>") + "       latest or live score (e.g. score dodgers)",
  A.cyan("schedule <team>") + "    next few games (e.g. schedule lakers)",
  "",
  A.dim("covers MLB · NBA · NFL — names resolve automatically"),
  A.dim("collisions (Cardinals): prefix a league → score nfl cardinals"),
  A.dim("data from ESPN's public endpoints (unofficial, may change)"),
]);

// agent tools
ctx.registerAgentTool(
  { type: "function", function: { name: "sports_score", description: "Get the latest or live score for an MLB, NBA, or NFL team by name.", parameters: { type: "object", properties: { team: { type: "string" }, league: { type: "string", enum: ["mlb", "nba", "nfl"] } }, required: ["team"] } } },
  async function (a) {
    const hits = await resolve(a.team, a.league);
    const t = hits[0];
    const ev = await findInScoreboard(t);
    if (!ev) {
      const n = await nextEvent(t);
      return JSON.stringify({ team: t.display, status: "no game today", next: n ? { when: fmtDate(n.date), localTime: fmtLocalTime(n.date), matchup: n.shortName || n.name } : null });
    }
    const comp = (ev.competitions || [])[0] || {};
    const cs = (comp.competitors || []).map(function (c) { return { team: c.team && c.team.abbreviation, score: scoreOf(c), homeAway: c.homeAway }; });
    return JSON.stringify({ team: t.display, status: statusOf(ev).shortDetail || statusOf(ev).description, competitors: cs });
  }
);
ctx.registerAgentTool(
  { type: "function", function: { name: "sports_schedule", description: "Get upcoming games for an MLB, NBA, or NFL team by name.", parameters: { type: "object", properties: { team: { type: "string" }, league: { type: "string", enum: ["mlb", "nba", "nfl"] } }, required: ["team"] } } },
  async function (a) {
    const hits = await resolve(a.team, a.league);
    const t = hits[0];
    const d = await getJson(teamUrl(t));
    const next = ((d.team && d.team.nextEvent) || []).slice(0, 3).map(function (ev) { return { when: fmtDate(ev.date), localTime: fmtLocalTime(ev.date), matchup: ev.shortName || ev.name }; });
    return JSON.stringify({ team: t.display, upcoming: next });
  }
);
