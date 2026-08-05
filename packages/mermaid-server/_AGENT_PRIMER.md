# \_AGENT_PRIMER — mermaid-server (chart.chem.dev)

Primer for a fresh session working in this package. Read this before touching `src/`.
Written 2026-08-04.

---

## What this is

A Fastify HTTP API that renders mermaid diagrams to SVG **server-side**, living inside a
fork of upstream mermaid so it can import the library directly.

- **Package**: `packages/mermaid-server/` inside `jgatlit/mermaid` (fork of `mermaid-js/mermaid`)
- **Public URL**: `https://chart.chem.dev` · **local**: `http://localhost:3001`
- **mermaid version**: 11.12.2 (`GET /api/v1/health` reports it)
- **Repo remotes**: `fork` → `git@github.com:jgatlit/mermaid.git`, `origin` → upstream mermaid-js
- **Branch**: `develop`

## The one architectural fact that governs everything

**This is not a headless browser.** It runs **JSDOM in-process**. JSDOM has no CSS layout
engine, no paint, no viewport — so every geometry primitive mermaid relies on is a
hand-written mock in `src/renderer/environment.ts`:

| Mock                      | What it does                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `getBBox()`               | geometric union when real boxes exist; else `chars × 8` wide, `rows × 24` tall; zeros when empty |
| `getComputedTextLength()` | `text.length × 8`                                                                                |
| `getBoundingClientRect()` | same heuristic as `getBBox`                                                                      |

Every layout bug in this service has so far traced back to those three functions. Before theorising
about mermaid internals, check whether the mock is simply returning the wrong number.

Older docs (`Documents/noboxAI/SecondAct/docs/specs/mermaid-server-foreignobject-fix.md`)
describe this as a Puppeteer/Playwright server. **That is wrong** and it sends you down a
"wait for browser layout" path that cannot apply. Trust `environment.ts`.

## Layout

```
src/
  app.ts                  Fastify app assembly
  config.ts               env-driven server config (PORT, MERMAID_THEME, …)
  index.ts                entrypoint
  renderer/
    environment.ts        ← JSDOM + the geometry mocks. The hot spot.
    mermaid-bridge.ts     ← mermaid.initialize/render wrapper + config defaults
    queue.ts              serialises renders (mermaid holds global state)
  routes/                 render · parse · detect · extract · batch · jobs · health
  errors/normalize.ts     error shape normalisation
  storage/store.ts        async job store
test/
  renderer/ integration/ e2e/ storage/ errors/
```

### Defaults that are hardcoded, not configurable

`mermaid-bridge.ts` (~line 45):

```ts
securityLevel: 'strict',
htmlLabels: false,        // ← server-wide. Callers cannot turn this on.
gantt: { useWidth: 960 },
```

`htmlLabels: false` is why flowcharts emit SVG `<text>`/`<tspan>` rather than
`<foreignObject>`. A caller passing `htmlLabels: true` is silently overridden. Separately,
`BLOCKED_CONFIG_KEYS` (`securityLevel`, `secure`, `maxTextSize`, `logLevel`, `startOnLoad`)
are **stripped from caller config without warning**.

## Deploy — there is no build step

PM2 runs the TypeScript directly:

```js
// ecosystem.config.cjs
name: 'mermaid-server', script: 'npx', args: 'tsx src/index.ts',
cwd: '/home/jgatlit/apps/mermaid/mermaid/packages/mermaid-server',
env: { PORT: 3001, HOST: '0.0.0.0', NODE_ENV: 'production' }
```

So: **edit `src/*.ts` → `pm2 restart mermaid-server` → live.** No compile, no artifact.
That makes iteration fast and makes an accidental edit equally fast to ship — verify
against the live endpoint after every restart.

- PM2 id 13, `mermaid-server`. It sat at **54 days uptime / 0 restarts** before the 2026-08-04 work — i.e. the geometry bugs had been live and silently shipping that whole time.
- **Caddy**: `chart.chem.dev` block at `/etc/caddy/Caddyfile` **line 790**, logging to
  `/var/log/caddy/chart-chem-dev.log`. It is inline in the Caddyfile, _not_ an imported
  `~/apps/<proj>/<host>.caddy` snippet like most other hosts here — don't go looking for
  a snippet file, there isn't one.

### Two paths to the same files

`vps:~/apps/mermaid/mermaid/` is also mounted locally at `~/vps/apps/mermaid/mermaid/`
(SSHFS). Editing either is editing the same file. PM2's `cwd` is the **VPS-native** path;
use `ssh vps` for `pm2` and `git`, and either path for edits.

## Repo convention: ops docs live untracked

`ISSUE-*.md`, `ecosystem.config.cjs`, `setup-caddy.sh`, `fix-*.sh` are all **untracked**
(`git status` shows them as `??`) and deliberately so — this is a fork of upstream mermaid
and committing local ops files onto `develop` would pollute the diff against `origin`.
Keep new operational docs untracked here. If something needs to be durable, file it as an
issue on `jgatlit/mermaid` and/or push it to nobox-vault.

## Geometry status, as of 2026-08-04

Read `ISSUE-multiline-label-measurement.md` before making any layout claim.

**Fixed and live (2026-08-04), committed `6819cbc52` + `10d78bb7b` on `fork/develop`:**
`getBBox` now counts `<tspan>` rows for line height, unions real laid-out geometry
(rects/circles/edge paths with cumulative translates) for `<g>`/`<svg>`, parses path `d`
command-aware, and reports **zero bounds for empty text and empty containers**. Node
heights scale with row count and every diagram type bounds its own content
(`uncovered = 0px`). Closes the multi-line label bug, `ISSUE-viewbox-undersize.md`, and
issue #9. **96 tests.**

The empty-bounds one is the subtle one: mermaid measures an edge label through its
`<text>`, not the wrapping `<g>`, so an unlabelled edge's empty `<text>` hit the 100×100
fallback and dagre reserved a full label of rank space for nothing. An _empty_ edge label
cost more than a real one (gap 250 vs 178) until this landed; it is now 150.

**Still open:**

1. **`\n` in a label renders as literal `\` + `n`.** `<br/>` is the only working
   line-break form. Undocumented in `REFERENCE.md`.
2. **2+ markdown list items in a wrapping label → `500`**, marker-agnostic (`+`/`-`/`*`),
   and `/api/v1/parse` reports `valid: true` for the same payload. Should be a `422`.
3. **`mindmap` → `Cannot read properties of undefined (reading 'h')`** — unrelated,
   long-standing.
4. **`CHAR_WIDTH = 8` approximates font metrics**, so layouts come out **narrower** than a
   real browser (~0.50–0.64× mermaid-cli width on the Lane B set). Height overshoot is now
   only 1.06–1.61×. Complete and correctly bounded, but not pixel-equivalent to Chrome.
   This is the next lever if proportions ever need to match a browser.

✅ **Committed** as `6819cbc52` + `10d78bb7b` on `fork/develop`; working tree clean and the running process matches. PM2 still runs the working tree, so check `git status` before any git operation here — an uncommitted edit IS production.

Diagram-type guidance predating 2026-08-04 ("prefer sequenceDiagram", "flowcharts >3 nodes
have broken aspect ratios", "LR layouts stack vertically") was largely a symptom of the
geometry bugs above and is now **stale — re-test before trusting it**. `stateDiagram` and
`erDiagram` in particular got materially shorter. Still genuinely broken: `mindmap`,
`timeline`, `radar`, `quadrantChart`. The older matrix lives in the
`Documents/noboxAI/SecondAct` project memory.

## Verification protocol

Never trust a 200 or a `success: true` — this service's failure mode is **valid SVG with
wrong geometry**.

```bash
BASE=https://chart.chem.dev
# 1. health / version
curl -s $BASE/api/v1/health
# 2. render and assert on geometry, not status
curl -s -X POST $BASE/api/v1/render -H 'Content-Type: application/json' \
  -d '{"diagram":"flowchart TD\n  A[\"One<br/>Two<br/>Three\"] --> B[\"x\"]"}' \
| grep -oE 'viewBox="[^"]*"|height="[0-9.]+"' | head -3
# node height must now vary with line count. If it says 54, the fix did not land.
# 3. foreignObject must be absent
… | grep -c foreignObject   # expect 0
```

Run `npx vitest run` in this package (**96 tests, ~6s**). The suite had _no_ multi-row
label fixture until 2026-08-04 — that gap is exactly what let #7 be closed while still
broken. Thirteen geometry fixtures now guard it. Add one with any layout change.

The strongest validation available here is **comparing node `translate()` positions before
and after**: if they are byte-identical, the layout is unchanged and only the reported
bounds moved. That is how `6819cbc52` was proven safe.

## Consumers to not break

- `mermaid-pro` skill (`~/.claude/skills/mermaid-pro/`, source in `~/projects/claude-skills`)
- `/spec-to-visual-artifact` → `/csa-pipeline` → `/project-spec-authoring` (batch endpoint)
- FLY System Copilot — concept-card artifacts + inline markdown pipeline; already carries a
  client-side `getBBox()` viewBox recalculation to work around #4
- M Hudson deliverables — currently **bypassing this server** for `mermaid-cli` + real Chrome
