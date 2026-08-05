# \_AGENT_PRIMER — mermaid-server (chart.chem.dev)

Primer for a fresh session working in this package. Read this before touching `src/`.
Written 2026-08-04.

---

## What this is

A Fastify HTTP API that renders mermaid diagrams to SVG **server-side**, living inside a
fork of upstream mermaid so it can import the library directly.

- **Package**: `packages/mermaid-server/` inside `jgatlit/mermaid` (fork of `mermaid-js/mermaid`)
- **Public URL**: `https://chart.chem.dev` · **local**: `http://localhost:3001`
- **mermaid version**: 11.16.0 as of 2026-08-05 (`GET /api/v1/health` now resolves this from the installed package rather than a literal — it lied for months before that, do not trust older quotes of it)
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

### Defaults — and which of them a caller can actually override

`mermaid-bridge.ts` (~line 45):

```ts
securityLevel: 'strict',   // BLOCKED key — stripped from caller config, and warns
htmlLabels: false,         // DEFAULT ONLY — `...config` spreads after, so callers CAN override
gantt: { useWidth: 960 },  // default, overridable
```

`htmlLabels: false` is why flowcharts emit SVG `<text>`/`<tspan>` rather than
`<foreignObject>` **by default**.

⚠️ **CORRECTED 2026-08-05 — an earlier version of this primer said "a caller passing
`htmlLabels: true` is silently overridden." THAT WAS WRONG.** These are DEFAULTS, and
`...config` is spread AFTER them, so caller config WINS. `htmlLabels` is NOT in
`BLOCKED_CONFIG_KEYS`. Verified live:

| config                               | `<foreignObject>` |                      `<tspan>` |
| ------------------------------------ | ----------------: | -----------------------------: |
| `{}`                                 |                 0 |                              7 |
| `{"htmlLabels": true}`               |             **3** |                          **0** |
| `{"flowchart":{"htmlLabels": true}}` |                 0 | 7 (nested form is a DEAD PATH) |

This matters: `<foreignObject>` **does not render inside an `<img>`-loaded SVG**, which is how
markdown and most docs embed these. A caller who enables it gets coloured boxes with no words,
200 OK, no warning. Tracked as `tsk_beea3c5aadcd4c579ce8`.

`BLOCKED_CONFIG_KEYS` (`securityLevel`, `secure`, `maxTextSize`, `logLevel`, `startOnLoad`)
ARE stripped from caller config — and **as of 2026-08-05 they now warn** (`warnings[]` on the
JSON path, `X-Mermaid-Warnings` header on raw-SVG and PNG paths). The earlier "stripped
without warning" note is obsolete.

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

## Repo convention: ops docs are TRACKED (changed 2026-08-05)

⚠️ **This section previously said these files live untracked. That is no longer true.**
`_AGENT_PRIMER.md`, `ISSUE-*.md`, `ecosystem.config.cjs`, `setup-caddy.sh` are now all
**tracked** and committed on `develop`. The earlier rationale — that committing local ops
files onto a fork of upstream mermaid would pollute the diff against `origin` — was
outweighed by the practical cost: an untracked operational doc has no history, no review,
and silently diverges from the code it describes.

Practical consequence: **edits to these files are now ordinary uncommitted changes** and
will sit dirty in a tree that is also the deploy unit. Commit them like any other change.
Durable cross-repo records still belong in nobox-vault; this is for repo-local operational
context.

## Geometry status, as of 2026-08-04

Read `ISSUE-multiline-label-measurement.md` before making any layout claim.

**Fixed and live (2026-08-04), committed `6819cbc52` + `10d78bb7b` on `fork/develop`:**
`getBBox` now counts `<tspan>` rows for line height, unions real laid-out geometry
(rects/circles/edge paths with cumulative translates) for `<g>`/`<svg>`, parses path `d`
command-aware, and reports **zero bounds for empty text and empty containers**. Node
heights scale with row count and every diagram type bounds its own content
(`uncovered = 0px`). Closes the multi-line label bug, `ISSUE-viewbox-undersize.md`, and
issue #9. **170 tests across 15 files** as of 2026-08-05 (was 87 before this work began).

The empty-bounds one is the subtle one: mermaid measures an edge label through its
`<text>`, not the wrapping `<g>`, so an unlabelled edge's empty `<text>` hit the 100×100
fallback and dagre reserved a full label of rank space for nothing. An _empty_ edge label
cost more than a real one (gap 250 vs 178) until this landed.

⚠️ **The absolute gap numbers have since MOVED.** After the 11.13.0→11.16.0 sync the plain-edge
gap is **104** and the labelled-edge gap **132** (they were 150 / 178). Both dropped by 46px;
the 28px differential and the `empty < labelled` invariant both survived. Attribution to the
sync specifically is probable but NOT isolated — five changes landed between the two builds
measured. **Assert the RELATIONSHIP (empty must cost less than labelled), not the absolutes** —
the absolutes move with every upstream sync and will make a regression test lie.

**Still open:**

1. ~~`\n` renders literally~~ **FIXED 2026-08-05** — literal `\n` is now normalised to a
   line break and renders identically to `<br/>`, and it WARNS (`warnings[]` / header).
2. ~~2+ markdown list items → 500~~ **FIXED 2026-08-05** — renders 200 with label text and
   markers intact.
3. **`mindmap` → `Cannot read properties of undefined (reading 'h')`** — still open. Part of a
   MISSING-JSDOM-GLOBAL FAMILY, all the same one-line class of fix:
   `CSSStyleSheet` (fixed, 47bca6d77) · `screen` (c4 diagrams, still 500) ·
   `Image` (flowchart `img` node-shape, still 500). Worth landing together.
4. **A single unbroken ~50k-char label WEDGES the process** — event loop blocks, socket
   accepts but never services, `/health` hangs rather than reporting degraded. The 50k guard
   counts TOTAL characters; the hazard is one un-wrappable token. See `tsk_4b761e409d444d2096e5`.
5. **`CHAR_WIDTH = 8` approximates font metrics**, so layouts come out **narrower** than a
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

Run `npx vitest run` in this package (**170 tests / 15 files, ~6s** as of 2026-08-05 — count
this yourself rather than trusting this line, it moves). The suite had _no_ multi-row
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
