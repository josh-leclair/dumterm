# dumterm

A terminal that runs your macros, not your shell. Windows-only, Electron + vanilla JS, no build step.

## Setup

Needs Node.js (LTS is fine). Then:

```
cd dumterm
npm install
npm start
```

First `npm install` downloads Electron (~100MB), so give it a minute. After that, `npm start` is instant.

`Ctrl+\`` (Ctrl + backtick) summons/hides the window from anywhere, even when you're in a game or another app.

## First macro in 30 seconds

```
create worktime
```

You're now in the wizard. Type `1 chrome` to search installed apps and add Chrome,
`1 spotify` for Spotify, then `8` to save. Now just type `worktime` and both launch.

Or skip typing entirely: while the wizard is open, **drag a shortcut from your Start
Menu or desktop onto the window** — it resolves the .lnk and adds it as an action.

`worktime --dry` shows what a macro would do without doing it.

## Built-ins

| command | what it does |
|---|---|
| `create <name>` | build a macro (wizard) |
| `<name>` | run it (`--dry` to preview) |
| `list` / `show <name>` | view macros |
| `edit <name>` | add/remove actions on an existing macro |
| `delete <name>` | remove |
| `examples` | copyable macro and condition examples |
| `actions` / `tools` | list macro step types and agent-callable tools (`action` / `tool` also work) |
| `doctor <name>` | check a saved macro for broken steps without running it |
| `apps <search>` | search installed apps (includes Microsoft Store apps) |
| `ask <question>` | stream a reply from LM Studio |
| `config` | view/set settings |
| `theme <name>` | phosphor · amber · ice · mono · sakura |
| `crt` | toggle scanlines |

Tab completes command names. Up/down arrows walk history. Ctrl+C cancels anything.
`help <topic>` works for built-in topics too: try `help do`, `help tools`,
`help actions`, `help timers`, or `help when`.

## Macro arguments

Any action field can hold placeholders, filled in when you run the macro:

- `{1}` `{2}` … positional words after the command name
- `{*}` everything after the command name
- `{1:default}` fallback value if the arg is missing

Quotes group words: `lights "warm white"` makes `{1}` = `warm white`.
A missing required placeholder aborts the whole macro before anything fires, and
`<macro> red --dry` shows the filled-in result without executing.

Examples worth stealing:

- `lights` with webhook body `{"scene":"{1}"}` → `lights red`, `lights movie`, `lights off`
- `trigger` with webhook URL `https://n8n.host/webhook/{1}` → every workflow reachable as `trigger <name>`
- `yt` with open target `https://youtube.com/results?search_query={*}` → `yt redstone door tutorial`
- `summarize` with an LLM prompt `Summarize: {*}`

## Timers & alarms

```
timer 15m                 chime in 15 minutes
timer 1h30m               supports h/m/s; a bare number means minutes
timer 25m lights red      run a macro when it fires (args pass through: timer 25m lights red)
at 22:30                  alarm at a clock time (rolls to tomorrow if already past)
at 22:30 winddown         run a macro at that time
timers                    list pending
cancel 3                  cancel timer #3
```

Countdown timers and macro `wait` steps show in the timer overlay; clock-time
alarms stay out of that box.

Timers chime, raise a desktop notification, and scatter sparkles in the terminal.
They live in the running session — closing dumterm clears them (session-persistent
timers are a later add if you want them).

## Action types

- **open** — apps (exe or Microsoft Store/UWP via `shell:AppsFolder`), file paths, URLs
- **keystroke** — synthetic key press via SendKeys
- **webhook** — HTTP request (your n8n endpoints)
- **run command** — chain another macro (loop-guarded, max depth 8)
- **wait** — pause between actions without locking the terminal; the remaining macro resumes later

## The agent — `do`

`ask` is a Q&A box; `do` lets the LLM actually pull dumterm's levers. Type a
plain-language request and the model plans a sequence of tool calls, shows you
the plan, and (after you confirm) runs them — feeding results back to itself so
it can chain steps.

```
do mute discord, set a timer for 30 minutes, and open a browser
do turn everyone in the channel down to 60%
do run my worktime macro then deafen me
do! quick mute            (the ! skips the confirm prompt)
```

It can: create and delete reusable macros, run/find your macros, launch apps,
control Discord voice, set timers, hit webhooks, and the per-user volume controls.
Run `tools` to see the exact agent-callable functions currently available, and
`actions` to see the macro step types it can save.
The agent can also call `preview_macro` to dry-run a saved macro before firing it.
Ask it to "make me a gamenight command that opens Discord and Minecraft and deafens
me" and it builds a real saved macro you can call forever (and edit by hand later),
not a one-off. Safe/reversible steps
(listing, mute, timers) run without confirmation; anything that launches, posts,
or changes other people prompts you first unless you use `do!`.

For a natural-language IF/ELSE macro, the model now has a dedicated
`create_branching_macro` tool. It takes actions before the choice, one condition,
the true/false branches, and actions after it. Dumterm turns that
into the same normal flat macro actions used everywhere else, and evaluates the
shared condition only once per run. That makes a request like this reliable even
with smaller local models:

```
do create gameday: show today's weather; if the Dodgers are playing today play some hype music, otherwise play some lofi; then set a 30 minute timer
```

If `do` throws a 400 or LM Studio logs a "Channel Error": run `config lmstudio.test`.
It checks reachability, whether your model string is actually loaded, plain chat,
and tool calling as four separate lines, so you can see exactly which stage fails.
Plain-chat-ok-but-tools-fail means the model build can't do tool calling — switch
to a tool-tuned model. (dumterm's tool schemas were also fixed in v0.5 to avoid an
empty-parameter quirk that tripped some llama.cpp builds.)

Reality check: this rides on your local model. A 12B is fine for "do these three
things"; multi-step reasoning (list users, then loop) is where smaller models
wobble. If Gemma fumbles tool calls, Qwen 2.5 (14B) is specifically strong at
function calling and a similar footprint — worth keeping around just for `do`.
Every proposed call is validated before running, and bad macro/app names fail
loudly rather than guessing.

## Stream Deck buttons

Named buttons are managed from dumterm and mirrored to the Stream Deck plugin.
Old numeric names like `1`, `2`, `3`, and `4` still work, but you can now use
clear labels like `panic`, `brb`, or `morning`:

```
buttons                       show named buttons
buttons panic                 inspect one assignment without running it
bind panic brb_mode           run a macro from the panic button
bind mute "discord togglemute" run a command line from mute
label panic Panic             change the display label
unbind panic                  clear a button
button panic                  run a button locally
```

The agent has matching tools: `list_buttons`, `set_button`, `label_button`,
`clear_button`, and `run_button`. Those tools prefer a `button` name, with the
old `slot` field kept as a compatibility alias.

In the Stream Deck property inspector, enter the same button name and press
**Refresh buttons**. It pulls the current named assignments from Dumterm, offers
them as suggestions, and shows whether the selected name is really bound. The
key inherits Dumterm's display label by default, so `label panic Panic` updates
the key without retyping it in Stream Deck; the inspector's Label field is only
for a deliberate per-key override.

Use `api` for the localhost control server details. `api on` / `api off` toggle it,
and `api newtoken` rotates the token. The agent can manage that server too with
`control_api_status`, `set_control_api_enabled`, and `rotate_control_api_token`,
but token viewing stays in the local `api` command. Token-authenticated clients
can also call `GET /buttons` to read the current named assignments.

## Discord setup (RPC)

dumterm talks to the Discord desktop client over its local RPC pipe — real voice
control, no keystroke games. One-time setup:

1. https://discord.com/developers/applications → New Application (name it anything)
2. Copy the **Application ID** from General Information
3. OAuth2 page → add redirect `http://localhost` → Reset Secret → copy the **Client Secret**
4. In dumterm:
   ```
   config discord.clientId <application id>
   config discord.clientSecret <secret>
   discord connect
   ```
5. Discord pops a one-time authorization modal — approve it. The token is saved
   and refreshed automatically; you won't see the modal again.

Then the voice ops: `discord mute` / `unmute` / `togglemute` / `deafen` /
`undeafen` / `toggledeafen` / `status` — available as macro actions too (wizard
option 4), so a macro can launch a game, deafen you, and hit an n8n webhook.

Plus channel controls:

```
discord users                  who's in your voice channel, with volumes
discord uservolume alex 60     set one person to 60% (matches by name)
discord allvolume 80           set everyone (except you) to 80%
```

Per-user volume is local — it changes how loud people are *to you*, not for the
channel. This is the privileged-scope corner mentioned at setup; if `uservolume`
errors where `mute` worked, add yourself to the app's tester list (Developer
Portal → your app → App Testers).

Notes: Discord must be running. Only one app can drive Discord voice settings at
a time (a Stream Deck Discord plugin would conflict). On Windows, Dumterm protects
the client secret, API token, and OAuth refresh tokens with the current Windows
user's built-in credential encryption.

### SendKeys cheat sheet

`^` Ctrl · `+` Shift · `%` Alt · `{F13}`..`{F16}` · `{ENTER}` `{TAB}` `{ESC}`
Example: `^+{F13}` = Ctrl+Shift+F13. Plain letters are just letters: `^k` = Ctrl+K.

## LM Studio

On the Mac mini, enable the local server in LM Studio (and "serve on local network"
so it listens beyond localhost). Then in dumterm:

```
config lmstudio.url http://<mac-tailscale-name>:1234
ask how do I exit vim
```

Responses stream into the terminal. `config lmstudio.model <name>` if you want to
pin a specific model; otherwise LM Studio uses whatever's loaded.

## n8n webhooks

In the wizard pick `3`, paste your webhook URL, choose method, optionally a JSON
body. A macro can open apps AND hit n8n AND chain other macros — `worktime` can set
your Govee lights through an n8n flow while launching Chrome and Spotify.

## Plugins

Integrations live as self-contained files in the `plugins/` folder next to the app.
On startup dumterm loads each one and merges its commands, macro action types, and
agent tools into the app — no core changes needed. Drop a `.js` file in, restart,
and its commands just exist.

Isolation: plugins run with the privileged globals (`window`, `require`, `process`,
`dum`, `fetch`) shadowed out of scope. A plugin can only touch the `ctx` object the
core hands it — `ctx.http`, `ctx.oauth`, `ctx.config`, `ctx.events`, `ctx.notify`,
`ctx.runMacro`, `ctx.open`, `ctx.print`/`ctx.println`, `ctx.markdown`, `ctx.editText`,
`ctx.shared(group)` (borrow another plugin's config/OAuth), and the register functions (`registerCommand`,
`registerAction`, `registerAgentTool`, `registerOperation`, `registerPanel`,
`registerState`, `registerCompletion`, `registerHelp`, `registerAgentContext`,
plus `safeTools`/`configHint`). It can't reach the OS, the filesystem, or the IPC
bridge directly. Good enough for plugins you write yourself; keep treating the
folder as trusted local code, not as a marketplace sandbox. The privileged side
still validates storage, launches, and HTTP requests before doing anything dangerous.

The core itself is plugin-agnostic — it hardcodes no plugin names. A plugin declares
its own integration points: `ctx.safeTools(["my_read_tool"])` to let read-only agent
tools run without a confirm, `ctx.configHint(["apiKey"])` so `config myplugin.<Tab>`
suggests keys, and `ctx.shared("otherplugin")` to reuse another plugin's credentials.

Plugins can also provide a compact display surface. `ctx.registerPanel({id:
"my-panel", corner:"top-right", render})` keeps the original in-terminal HUD
behavior, while `ctx.registerPanel({id:"my-panel", area:"right", title:"My panel",
render})` creates a card in the dedicated right-side dock. The dock appears only
while at least one visible plugin has content. Drag the dock's left divider to
resize it; double-click the divider to return it to the default width. Core owns
visibility: use `panel`, `panel my-panel`, or `panel my-panel on|off`.
`status <plugin>` remains a compatibility alias.

### Spotify plugin

Controls playback on your active Spotify Connect device (the desktop or phone app
must be open — the Web API drives an existing player, it isn't one itself). Premium
is required for playback control, and it needs a one-time auth like Discord:

1. https://developer.spotify.com/dashboard → Create app
2. Redirect URI, exactly: `http://127.0.0.1:8123/callback`
3. Copy the Client ID
4. In dumterm:
   ```
   config spotify.clientId <your client id>
   spotify connect
   ```
   A browser opens, you approve, the tab says connected. Token is saved and
   refreshed automatically (PKCE — no client secret stored).

Commands: `play [query]` · `pause` · `next` · `prev` · `vol <0-100>` · `now` ·
`spotify connect`. With no query `play` resumes; with one it searches and plays the
best match. Force a type with `play artist daft punk`, `play playlist focus`, or
`play album discovery`. Bare `play <name>` now scores results by name match, so
`play section.80` plays the album rather than a stray track. Both `spotify <op>`
and the bare aliases (`play`, `pause`, `now`, …) work — they're the same handlers. There's also a `spotify` macro action type and agent tools,
so `do play some lofi and set my lights` works, and a macro can open your editor and
start a playlist in one step.

## Where your data lives

`%APPDATA%/dumterm/data/commands.json` stays ordinary JSON, so it is easy to back up
or edit when Dumterm is closed. `config.json` and OAuth token files are transparently
protected with the current Windows user's credential encryption after their next save.
Existing plain settings still load and migrate automatically. Keep encrypted data on
the same Windows account; use Dumterm's `config` command to change settings rather
than editing the encrypted file directly.

## Known v1 edges

- Synthetic keystrokes won't reach apps running elevated (as admin) unless dumterm
  is also elevated. Discord normally isn't elevated, so mute works.
- `open` actions fire sequentially with ~150ms between — "simultaneous" enough.
- Some antivirus tools side-eye apps that send keystrokes. It's PowerShell SendKeys
  under the hood; whitelist the folder if yours complains.
- Plugins are local trusted code. The app limits the privileged operations they can
  ask for, but you should still only drop plugin files into `plugins/` that you
  wrote or reviewed.

## Later: a real .exe

When you want a packaged build that lives in your startup folder:
`npm i -D electron-builder`, add a build config, `npx electron-builder --win`.
Not needed to use it day to day.
