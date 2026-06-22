// Weather plugin for dumterm — Open-Meteo (no API key needed).
// `weather`            current + forecast for your saved location
// `weather <zip>`      one-off lookup by US zip
// `weather set <zip>`  save a default location
//
// Runs capability-isolated: only `ctx`.

const A = ctx.ansi;

// WMO weather codes -> short label + glyph
const WMO = {
  0: ["clear", "☀"], 1: ["mostly clear", "🌤"], 2: ["partly cloudy", "⛅"], 3: ["overcast", "☁"],
  45: ["fog", "🌫"], 48: ["rime fog", "🌫"],
  51: ["light drizzle", "🌦"], 53: ["drizzle", "🌦"], 55: ["heavy drizzle", "🌧"],
  61: ["light rain", "🌦"], 63: ["rain", "🌧"], 65: ["heavy rain", "🌧"],
  66: ["freezing rain", "🌧"], 67: ["freezing rain", "🌧"],
  71: ["light snow", "🌨"], 73: ["snow", "🌨"], 75: ["heavy snow", "❄"], 77: ["snow grains", "🌨"],
  80: ["light showers", "🌦"], 81: ["showers", "🌧"], 82: ["heavy showers", "⛈"],
  85: ["snow showers", "🌨"], 86: ["snow showers", "🌨"],
  95: ["thunderstorm", "⛈"], 96: ["thunderstorm + hail", "⛈"], 99: ["severe thunderstorm", "⛈"],
};
function describe(code) { return WMO[code] || ["—", "·"]; }

async function getJson(url) {
  const r = await ctx.http({ url: url, method: "GET" });
  if (!r.ok) throw new Error("http " + r.status);
  try { return JSON.parse(r.body); }
  catch (e) { throw new Error("bad response (" + String(r.body || "").length + " chars)"); }
}

// US zip -> { lat, lon, name } via Open-Meteo's geocoding (zippopotam fallback not needed)
async function geocodeZip(zip) {
  const d = await getJson("https://api.zippopotam.us/us/" + encodeURIComponent(zip));
  const p = d.places && d.places[0];
  if (!p) throw new Error("zip not found: " + zip);
  return { lat: parseFloat(p.latitude), lon: parseFloat(p.longitude), name: p["place name"] + ", " + p["state abbreviation"] };
}

// US state abbreviation -> full name, to match Open-Meteo's admin1 (e.g. "tx" -> "texas")
const US_STATES = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

function scoreGeo(r, hint, wantState) {
  const a1 = String(r.admin1 || "").toLowerCase();
  const cc = String(r.country_code || "").toLowerCase();
  const cn = String(r.country || "").toLowerCase();
  let s = 0;
  if (a1 === wantState || a1 === hint) s += 60;
  else if (a1.indexOf(hint) === 0) s += 30;
  if (cc === hint || cn === hint || cn.indexOf(hint) === 0) s += 40;
  return s;
}

// City name (optionally "City, ST" / "City, Country") -> { lat, lon, name } via Open-Meteo geocoding
async function geocodeCity(query) {
  query = String(query).trim();
  let city = query, hint = "";
  const comma = query.indexOf(",");
  if (comma !== -1) {
    city = query.slice(0, comma).trim();
    hint = query.slice(comma + 1).trim().toLowerCase();
  } else {
    const parts = query.split(/\s+/);
    const last = parts[parts.length - 1].toLowerCase();
    // a trailing 2-letter token or known US state abbrev is a state hint, not part of the name
    if (parts.length > 1 && (/^[a-z]{2}$/.test(last) || US_STATES[last])) {
      hint = last;
      city = parts.slice(0, -1).join(" ");
    }
  }
  const search = async function (name) {
    const d = await getJson("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=10&language=en&format=json");
    return d.results || [];
  };
  let results = await search(city);
  if (!results.length && city !== query) results = await search(query); // fall back to the whole string
  if (!results.length) throw new Error("couldn't find a place called '" + query + "'");
  if (hint) {
    const wantState = US_STATES[hint] || hint;
    results.sort(function (a, b) { return scoreGeo(b, hint, wantState) - scoreGeo(a, hint, wantState); });
  }
  const r = results[0];
  const region = r.admin1 ? ", " + r.admin1 : (r.country ? ", " + r.country : "");
  return { lat: r.latitude, lon: r.longitude, name: r.name + region };
}

async function resolveLocation(arg) {
  if (arg) {
    arg = String(arg).trim();
    if (/^\d{5}$/.test(arg)) return geocodeZip(arg);
    return geocodeCity(arg);
  }
  const saved = ctx.config.get("location") || ctx.config.get("zip");
  if (saved) return /^\d{5}$/.test(String(saved)) ? geocodeZip(saved) : geocodeCity(saved);
  throw new Error("no saved location — try `weather <city or zip>` or `weather set <city or zip>`");
}

function fc(c) { return Math.round(c * 9 / 5 + 32); } // °C -> °F

function dayCount(n) {
  n = parseInt(n, 10);
  if (!n || isNaN(n)) return 4;
  return Math.max(1, Math.min(7, n));
}

async function fetchWeather(loc, days) {
  days = dayCount(days);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=celsius&wind_speed_unit=mph&forecast_days=" + days + "&timezone=auto";
  return getJson(url);
}

function dayName(iso, idx) {
  if (idx === 0) return "today";
  if (idx === 1) return "tomorrow";
  const d = new Date(iso + "T12:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

async function showWeather(arg, days) {
  const loc = await resolveLocation(arg);
  const w = await fetchWeather(loc, days);
  const cur = w.current;
  const [label, glyph] = describe(cur.weather_code);
  ctx.println(A.green(glyph + "  " + loc.name) + A.dim("  " + label));
  ctx.println("  " + A.bold(fc(cur.temperature_2m) + "°F") +
    A.dim("  feels " + fc(cur.apparent_temperature) + "°  ·  " +
      cur.relative_humidity_2m + "% humidity  ·  wind " + Math.round(cur.wind_speed_10m) + " mph"));
  ctx.println("");
  const d = w.daily;
  for (let i = 0; i < (d.time || []).length; i++) {
    const [dl, dg] = describe(d.weather_code[i]);
    ctx.println("  " + A.cyan(dayName(d.time[i], i).padEnd(9)) + dg + "  " +
      A.bold(fc(d.temperature_2m_max[i]) + "°").padEnd(14) +
      A.dim("low " + fc(d.temperature_2m_min[i]) + "°  " + dl));
  }
}

ctx.safeTools(["get_weather"]);
ctx.configHint(["location", "zip"]);

ctx.registerCommand("weather", {
  description: "current conditions + forecast (city or zip, or saved location)",
  run: async function (args) {
    const sub = (args[0] || "").toLowerCase();
    try {
      if (sub === "set") {
        const loc = args.slice(1).join(" ").trim();
        if (!loc) return ctx.println(A.dim("usage: weather set <city or 5-digit zip>"));
        const resolved = /^\d{5}$/.test(loc) ? await geocodeZip(loc) : await geocodeCity(loc); // validate
        await ctx.config.set("location", loc);
        return ctx.println(A.green("✓ saved default location: " + resolved.name));
      }
      let days = 4;
      if (sub === "week" || sub === "weekly" || sub === "7") {
        days = 7;
        args = args.slice(1);
      }
      await showWeather(args.length ? args.join(" ") : undefined, days);
    } catch (e) { ctx.println(A.red("✗ " + e.message)); }
  },
});

ctx.registerHelp([
  A.cyan("weather") + "                current conditions + 4-day forecast (saved location)",
  A.cyan("weather <city|zip>") + "     e.g. weather paris tx · weather london · weather 90210",
  A.cyan("weather set <city|zip>") + " save your default location",
  "",
  A.dim("no API key needed — powered by Open-Meteo (city + zip geocoding)"),
]);

// macro action: show weather as a step in a macro (e.g. a "morning" macro)
ctx.registerAction("weather", {
  describe: function (a) { const l = a.location || a.zip; return "weather" + (a.days === 7 ? " week" : "") + (l ? " " + l : " (saved location)"); },
  run: async function (a) { await showWeather(a.location || a.zip || undefined, a.days || 4); },
  agentHint: 'show the weather. Fields: {"type":"weather","location":"<optional city or US zip>","days":4|7}. Use days:7 when the user asks for the week. Omit location to use the saved location.',
  fromAgent: function (raw) {
    const days = raw.days || raw.forecastDays || (/week/i.test(String(raw.period || raw.forecast || "")) ? 7 : 4);
    return { type: "weather", location: raw.location || raw.zip || "", days: dayCount(days) };
  },
  label: "weather",
  fields: [
    { key: "location", prompt: "city or US zip", optional: true },
  ],
});

// agent tool
ctx.registerAgentTool(
  { type: "function", function: { name: "get_weather", description: "Get current weather and a short forecast for a place. Accepts a city (optionally with state/country, e.g. 'Paris, TX', 'London') or a 5-digit US zip; omit to use the saved location. Resolve the place from the user's words yourself and pass it as 'location' — do NOT look for a separate geocoding or zip-lookup tool.", parameters: { type: "object", properties: { location: { type: "string", description: "city name (optionally with state/country) or 5-digit US zip; optional" } } } } },
  async function (a) {
    const loc = await resolveLocation(a.location || a.zip);
    const w = await fetchWeather(loc, a.days || 4);
    const cur = w.current;
    return JSON.stringify({
      location: loc.name,
      now: { tempF: fc(cur.temperature_2m), feelsF: fc(cur.apparent_temperature), conditions: describe(cur.weather_code)[0], humidity: cur.relative_humidity_2m, windMph: Math.round(cur.wind_speed_10m) },
      today: { highF: fc(w.daily.temperature_2m_max[0]), lowF: fc(w.daily.temperature_2m_min[0]), conditions: describe(w.daily.weather_code[0])[0] },
      daily: (w.daily.time || []).map(function (date, i) { return { date: date, highF: fc(w.daily.temperature_2m_max[i]), lowF: fc(w.daily.temperature_2m_min[i]), conditions: describe(w.daily.weather_code[i])[0] }; }),
    });
  }
);
