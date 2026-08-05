# Handoff Prime — mermaid-server open eval findings (P1–P4)

> **STALENESS BANNER — added 2026-08-05 at commit time.** This bundle was composed at
> HEAD `b3024edd3`. FIVE commits landed after it: `6f305465e` (htmlLabels warning),
> `60928ed20` (cache SVG id re-key), `5f2130a08` (batch/jobs dispatch consolidation),
> `1bc131e3e` (primer corrections), `03a54a336` (PNG for batch/jobs). Its **P2b row is
> RESOLVED** and the **P3 PNG half is RESOLVED**. Re-read `git log` before acting on any
> row below. Deployed HEAD at time of commit: `03a54a336`.

- **Topic:** mermaid-server open eval findings: P1 error taxonomy, P2 remainder
  (timeline/kanban/quadrantChart/id-mapping), P2b htmlLabels, P3 batch/jobs
  parity, P4 detect/extract
- **Target:** `/home/jgatlit/apps/mermaid/mermaid` (this repo — the target IS
  the source; there is no cross-host copy step)
- **Host:** local (this machine is also the VPS running the PM2 deploy — see
  `_AGENT_PRIMER.md`)
- **Version:** 1 (first handoff on this topic — no prior `_HANDOFF_PRIME.md`
  existed)
- **Composed:** 2026-08-05T07:03Z
- **Source of this synthesis:** no prior `/find` session existed for this
  topic. This bundle was built by direct code + doc research in this session
  (git log, `gh issue/pr list`, and close reads of `_AGENT_PRIMER.md`,
  `REFERENCE.md`, `src/errors/normalize.ts`, `src/routes/{render,batch,jobs,
detect,extract}.ts`, `src/renderer/mermaid-bridge.ts`,
  `test/e2e/diagram-corpus.test.ts`) — **not** a re-statement of a prior
  synthesis. Treat every claim below as fresh-verified-2026-08-05, not
  inherited.

## Read order

1. `packages/mermaid-server/_AGENT_PRIMER.md` — canonical onboarding doc for
   this package, written 2026-08-04, corrected 2026-08-05. Authoritative on
   architecture, deploy, and geometry status.
2. `packages/mermaid-server/REFERENCE.md` — the API contract, including a
   **7-code error taxonomy table** (§9) and a **Known Limitations** section
   that already documents several of the items below. Read this before
   assuming any P1–P4 item below is undiscovered — some are documented-but-
   unfixed, not undocumented.
3. This file.
4. `_HANDOFF_REFERENCES.md` in this same directory — flat path catalog.

No `_handoff-context/` directory was created: every path this bundle
references is already in-tree at the target (target == source repo), so
nothing needed copying per the accessibility classifier (Stage 2 of the
`find-handoff-prime` skill this bundle follows).

## Executive summary

mermaid-server (`packages/mermaid-server/`, deployed at `chart.chem.dev`) went
through a heavy P0 stabilization pass on 2026-08-04/05 (PRs #17–#19: queue
timeout, warnings header sanitization, missing JSDOM globals for `screen`/
`Image`/`CSSStyleSheet`, `/health` version + outage detection). All P0 items
are merged and closed. **No GitHub issues or PRs are currently open** on
`jgatlit/mermaid` — the P1–P4 items below exist only in code/doc form, not as
tracked issues. This handoff exists to make sure a fresh session doesn't have
to re-derive them from scratch.

Five buckets, each graded on **how much is genuinely open** vs. **already
documented/handled and just needs verification**:

| Bucket                                                      | State                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 error taxonomy                                           | Documented (7 codes, `REFERENCE.md` §9) but **thin coverage** — one regex pattern covers all "parses fine, fails at render" cases; one route (`jobs.ts` 404) doesn't go through the shared `normalizeError`/`ApiError` shape                                         |
| P2 remainder (timeline/quadrantChart; `kanban` unconfirmed) | **Untested claim conflict** — `_AGENT_PRIMER.md` (2026-08-04) names `timeline`/`radar`/`quadrantChart` as "still genuinely broken" (not `kanban`); the only automated check (`diagram-corpus.test.ts`) asserts nothing strong enough to prove or disprove that today |
| id-mapping                                                  | **New finding this session, not previously documented anywhere** — a real cache/id interaction bug in `/render`, verified from code, not yet filed                                                                                                                   |
| P2b htmlLabels                                              | Behavior is correct and documented; the one known danger (silent invisible-text output) is **explicitly tracked but still open**, task `tsk_beea3c5aadcd4c579ce8`                                                                                                    |
| P3 batch/jobs parity                                        | **Confirmed via code diff** — `batch.ts`/`jobs.ts` do not propagate `warnings[]`, don't support PNG output, and jobs' 404 shape diverges from the standard error envelope                                                                                            |
| P4 detect/extract                                           | `detect.ts` is solid. `extract.ts`'s `validate: true` path inherits the documented "`/parse` is syntax-only" limitation as a **false-positive risk specific to extraction**, and its fence-matching regex has untested edge cases                                    |

## Current state (as of 2026-08-05, HEAD `b3024edd3`)

- Branch `develop`, 37 commits ahead of `origin/develop`, working tree clean.
- Last 3 merged PRs: #19 (missing `screen`/`Image` globals), #18 (render
  timeout), #17 (warnings header + P0 500 fix) — all 2026-08-05.
- `gh issue list --repo jgatlit/mermaid --state all` → 12 issues, **all
  closed**. `gh pr list ... --state all` → 7 PRs, **all merged**. Nothing is
  currently tracked as open work for this package outside this handoff.
- Owed by us: nothing blocking — this is exploratory/next-tier hardening
  work, not a fix for a live incident.
- Owed by nobody else: no external dependency.

## Findings by bucket

### P1 — Error taxonomy (`src/errors/normalize.ts`, `REFERENCE.md` §9)

`REFERENCE.md` §9 documents 7 codes: `PARSE_ERROR` (422), `UNKNOWN_DIAGRAM_TYPE`
(422), `RENDER_ERROR` (422), `NOT_FOUND` (404), `PNG_DISABLED` (400),
`INTERNAL_ERROR` (500), `RENDER_TIMEOUT` (503). The taxonomy itself is sound
and documented. Two concrete, verified gaps:

1. **`KNOWN_RENDER_INPUT_ERRORS` has exactly one entry** (`'does not support
newlines'`, for the markdown-list-wrapping crash). Any _other_
   parses-fine-but-fails-at-layout error that isn't a genuine server bug (a
   category `REFERENCE.md` itself calls out as real — "Diagram parses fine
   but its label content can't be laid out") falls through to
   `INTERNAL_ERROR`/500 by default in `normalizeError()`
   (`packages/mermaid-server/src/errors/normalize.ts:92-96`), which is the
   _server-bug_ bucket, not the _bad-input_ bucket. There's no process for
   auditing new render-time throws and classifying them correctly as they're
   discovered — each one currently requires hand-adding a substring match.
2. **`jobs.ts`'s 404 doesn't go through `normalizeError`/`ApiError`** — it's
   hand-built at `packages/mermaid-server/src/routes/jobs.ts:84-87` as
   `{ error: { code: 'NOT_FOUND', message } }`, omitting the `statusCode`
   field that `render.ts`/`detect.ts`/`batch.ts` all include in the body
   (via `apiError.statusCode`) alongside the HTTP status. Not a functional
   bug (HTTP status is still correct), but it means `NOT_FOUND` is the one
   taxonomy entry whose JSON shape isn't guaranteed to match the documented
   `ApiError` interface — worth either routing it through `normalizeError`
   or explicitly documenting the exception in `REFERENCE.md` §9.
3. **`mindmap` is still broken** (`Cannot read properties of undefined
(reading 'h')`, HTTP 500) per `REFERENCE.md`'s own Known Limitations and
   `_AGENT_PRIMER.md` "Still open" #3. It's part of the same
   MISSING-JSDOM-GLOBAL family that `CSSStyleSheet`/`screen`/`Image` were —
   PRs #17–#19 already fixed three of that family; mindmap's specific
   missing global hasn't been identified yet. Once found, this is a
   render-time-not-server-bug reclassification candidate for item 1 above,
   or a genuine new global to add to `environment.ts`.

### P2 remainder — timeline / kanban / quadrantChart

⚠️ **Correction from validation pass:** the topic line for this handoff names
`timeline/kanban/quadrantChart` together, but `_AGENT_PRIMER.md`'s actual
"Still genuinely broken" list is `mindmap, timeline, radar, quadrantChart` —
it does **not** name `kanban`. No evidence found this session that `kanban`
specifically has a known defect; it's included in `diagram-corpus.test.ts`
and nothing flags it as broken anywhere read this session. Treat `kanban`'s
presence in the original topic framing as "worth checking," not "known
broken" — don't inherit it as a confirmed defect in any follow-on work.

`packages/mermaid-server/test/e2e/diagram-corpus.test.ts` includes `timeline`,
`kanban`, and `quadrant` in its 19-diagram-type corpus and — as of the last
run implied by `_AGENT_PRIMER.md`'s "170 tests / 15 files" — they currently
pass. But the corpus test's assertions per diagram type
(`diagram-corpus.test.ts:41-77`) are deliberately loose: HTTP 200, `<svg` is
present, no `foreignObject` with `width="0"`/`height="0"`, and `viewBox`
width/height `> 0`. That's a _doesn't-crash-and-isn't-degenerate_ check, not
a _geometry-is-correct_ check.

`_AGENT_PRIMER.md` (written 2026-08-04, corrected 2026-08-05) is explicit:
"Still genuinely broken: `mindmap`, `timeline`, `radar`, `quadrantChart`."
That statement and the corpus test's green status are **not necessarily in
conflict** — a diagram can produce a non-degenerate, positive-area SVG that
is still visually wrong (wrong proportions, mispositioned quadrant
boundaries, overlapping timeline events) — but nothing in this repo currently
distinguishes those two states for these three types. This is the actual
open question: **is the primer's claim stale (superseded by the
6819cbc52/10d78bb7b geometry fixes and the 11.13.0→11.16.0 sync), or still
true?** Nobody has re-verified since 2026-08-04, and the tooling to verify it
(tight geometry assertions, or a visual diff against `mermaid-cli`) doesn't
exist yet for these three types the way it now does for flowchart (13
geometry fixtures per `_AGENT_PRIMER.md`).

`radar` and `mindmap` are also flagged broken by the primer but are **not**
in `DIAGRAM_FILES` in `diagram-corpus.test.ts` at all — they're excluded from
the corpus rather than xfail-marked, so there's no regression signal when
either gets fixed or breaks further.

### id-mapping — new finding, not previously documented

Not mentioned in `_AGENT_PRIMER.md`, `REFERENCE.md`, or MEMORY.md. Traced
this session from `mermaid-bridge.ts`:

- `render()` generates the mermaid `id` argument from a **module-scope,
  process-global counter**: `let renderCounter = 0;` /
  ``const id = `mermaid-server-${++renderCounter}`;``
  (`packages/mermaid-server/src/renderer/mermaid-bridge.ts:167,263`). Every
  call to `bridge.render()` — whether from `/render`, a batch item, or a job
  — gets a distinct, process-lifetime-unique id, and mermaid internally
  prefixes every child element id with that root id. This is exactly the
  mechanism needed to avoid DOM id collisions when multiple rendered SVGs
  from **separate render calls** are embedded together on one page (the
  scenario MEMORY.md flags re: upstream v11.13.0's own id-prefixing change)
  — and for `batch.ts` and `jobs.ts`, both of which call `bridge.render()`
  directly and bypass the cache, this guarantee holds cleanly: every batch
  item and every job gets a fresh, unique id.
- **`/render`'s response cache breaks that guarantee.** `render.ts` wraps
  `bridge.render()` with a `BoundedCache` keyed on
  `(diagram, config, outputFormat)` (`packages/mermaid-server/src/routes/
render.ts:74-80`). On a cache HIT, the stored SVG string — with whatever
  `id="mermaid-server-N"` was baked in at the original MISS — is returned
  verbatim. **Two separate HTTP requests with identical `diagram`+`config`
  will receive SVGs with the identical root id.** If a caller renders the
  same diagram twice (e.g., a template that reuses a shared diagram in two
  places on one page) and embeds both responses inline in the same document,
  the result is a duplicate DOM id. `gantt` is excluded from caching for an
  unrelated reason (`today` marker staleness); this id-collision path is not
  excluded and is not documented anywhere as a caveat of caching.
- This is **cache-specific** — `batch.ts` and `jobs.ts` don't wire in the
  `BoundedCache` at all (confirmed: neither imports `cache.ts` or
  `cacheKey`), so they're unaffected. Only direct `/render` calls that hit
  the cache are exposed.
- Not yet filed as an issue. Verification needed: fire two identical
  `/render` requests back-to-back, confirm the second is `X-Cache: HIT`, and
  diff the two SVG bodies' root `id` attribute — expect them to match
  (reproducing the bug), then decide whether the fix is (a) don't cache
  raw-SVG-embeddable outputs, (b) rewrite the id on every response
  (cached or not) before returning, or (c) document it as an intentional
  caller responsibility ("don't embed cache-eligible output twice without
  re-writing ids yourself").

### P2b — htmlLabels

Behavior itself is correct and unusually well-documented — `_AGENT_PRIMER.md`
lines 56–87 include a verified truth table (`{}` → 0 foreignObject/7 tspan;
`{"htmlLabels": true}` → 3 foreignObject/0 tspan; nested `flowchart.htmlLabels`
is a dead path). `REFERENCE.md` §8 repeats this. The one open risk: **a
caller who sets `htmlLabels: true` gets `<foreignObject>` output with zero
warning**, even though that output silently fails to render any visible text
when the SVG is loaded via `<img>` (the majority embedding pattern for
markdown/docs). Every _other_ silent-rewrite case in this codebase now warns
— blocked config keys warn (`warnings[]` / `X-Mermaid-Warnings` header, per
`REFERENCE.md` §"Blocked keys"), the literal-`\n`-to-`<br/>` rewrite warns —
but this one, arguably the highest-consequence one (200 OK, valid SVG,
literally no visible words), still doesn't. Tracked explicitly in
`_AGENT_PRIMER.md` as `tsk_beea3c5aadcd4c579ce8`. This is the cleanest,
smallest of the five buckets to close: add a warning when `htmlLabels`
resolves truthy in the effective config, following the exact pattern already
used for `strippedConfigWarnings`/`LITERAL_NEWLINE_WARNING` in
`mermaid-bridge.ts`.

### P3 — batch/jobs parity (vs. `/render`)

Confirmed by direct comparison of `render.ts` against `batch.ts` and
`jobs.ts`:

1. **Warnings are dropped.** `render.ts` surfaces `result.warnings` (both
   inline JSON and `X-Mermaid-Warnings` header). `batch.ts`'s per-item entry
   construction (`packages/mermaid-server/src/routes/batch.ts:63-80`) never
   reads `result.warnings` — a batch item that trips the literal-`\n`
   rewrite or a stripped-config-key warning gets **no signal at all** in the
   batch response. Same for `jobs.ts`'s `processJob()` — `result.warnings` is
   discarded, so a completed job's `metadata.json` never records warnings
   even though the underlying `bridge.render()`/`bridge.parse()` call
   produced them.
2. **No PNG output.** `render.ts` supports `outputFormat: 'png'` via
   `svgToPng()`. Neither `batch.ts` nor `jobs.ts` exposes an output-format
   choice — both are SVG (or AST-less parse/detect) only.
3. **No caching.** `batch.ts`/`jobs.ts` call `bridge.render()` directly,
   bypassing `render.ts`'s `BoundedCache` entirely. Correctness-neutral (and
   as the id-mapping finding above shows, arguably _safer_ than the cached
   path) but a real perf/consistency difference worth being intentional
   about rather than accidental.
4. **Error shape inconsistency** — see P1 item 2 above (`jobs.ts` 404).
5. Duplicated dispatch logic: the `if (op === 'detect') … else if (op ===
'parse') … else render` branch is hand-written independently in
   `batch.ts` and again in `jobs.ts`'s `processJob()`, with no shared helper.
   Any future fix to one (e.g., adding warnings propagation) has to be
   remembered and re-applied to the other by hand — the parity gaps above are
   a direct symptom of that duplication.

### P4 — detect/extract

- `detect.ts` (`packages/mermaid-server/src/routes/detect.ts`) is clean:
  schema-validated, uses the shared `errorResponse` schema, routes errors
  through `normalizeError`. No open findings here beyond the general P1
  taxonomy-coverage gap (an unrecognized-input string that reaches
  `mermaid.detectType()` and throws something outside the known patterns
  would still land on `INTERNAL_ERROR` rather than `UNKNOWN_DIAGRAM_TYPE`
  in edge cases — not verified either way this session).
- `extract.ts`'s `validate: true` path (`packages/mermaid-server/src/routes/
extract.ts:73-82`) calls **`bridge.parse()` only** — never
  `bridge.render()`. `REFERENCE.md` already documents "`/parse` is
  syntax-only… cannot guarantee `/render` will succeed for the same diagram"
  as a known, general limitation. Extraction inherits that limitation as a
  **specific false-positive risk**: a markdown document containing a
  `mermaid mindmap ...` block, run through `/api/v1/extract` with
  `validate: true`, will report `valid: true` for that block — because parse
  succeeds — even though rendering it is known to 500. Anyone building a
  pre-flight pipeline on `/extract`'s `validate` flag (the exact use case
  MEMORY.md flags for `/api/v1/batch` as _the_ documented pre-flight
  mechanism) needs to know `/extract`'s validation is weaker than
  `/batch`'s, since batch's render operation actually renders.
- `MERMAID_BLOCK_RE = /```mermaid\s*\n([\S\s]*?)```/g`
  (`extract.ts:19`) is untested against indented code fences (mermaid blocks
  nested inside numbered/bulleted markdown lists, which most markdown
  renderers indent 2–4 spaces) and fenced blocks with an info-string suffix
  beyond the bare word `mermaid` (e.g. ` ```mermaid title="foo"`). No
  fixture in `test/fixtures/sample.md` currently exercises either case —
  unverified whether they're handled or silently skipped.

## Decision log

No decisions have been made yet on any of these five items — this is a
findings handoff, not a decided work plan. Nothing to log.

## Open questions / blockers

1. Is the `_AGENT_PRIMER.md` "still genuinely broken: timeline, kanban→(not
   listed, but implied by topic), quadrantChart" claim current, or stale
   relative to the 2026-08-04/05 geometry fixes and the 11.16.0 sync? No
   blocker to investigating — just needs a session with either a live
   `chart.chem.dev` comparison or a `mermaid-cli`-rendered reference to diff
   against.
2. What is mindmap's actual missing JSDOM global? Same investigative pattern
   as `screen`/`Image`/`CSSStyleSheet` (PRs #17–#19) — likely a short fix once
   found, but not found yet.
3. For the id-mapping cache/collision finding: confirm the reproduction (two
   identical `/render` calls, diff root `id` on HIT vs MISS) before deciding
   a fix — this session did not hit a live server to confirm, it's a static
   code-read finding.
4. Decide the batch/jobs de-duplication approach before fixing the P3 parity
   gaps piecemeal — a shared "run one operation, return {success, data,
   warnings}" helper would close warnings-propagation and future-parity-drift
   in one move rather than patching `batch.ts` and `jobs.ts` separately again.

## Path catalog (all in-tree — target is the source repo)

| Path                                                           | What it is                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mermaid-server/_AGENT_PRIMER.md`                     | Canonical onboarding + architecture + geometry-status doc                                                                                     |
| `packages/mermaid-server/REFERENCE.md`                         | API contract, error taxonomy (§9), Known Limitations                                                                                          |
| `packages/mermaid-server/src/errors/normalize.ts`              | Error taxonomy implementation                                                                                                                 |
| `packages/mermaid-server/src/routes/render.ts`                 | Caching + warnings + PNG reference implementation                                                                                             |
| `packages/mermaid-server/src/routes/batch.ts`                  | Sync multi-item endpoint — parity gaps here                                                                                                   |
| `packages/mermaid-server/src/routes/jobs.ts`                   | Async job endpoint — parity gaps + 404 shape here                                                                                             |
| `packages/mermaid-server/src/routes/detect.ts`                 | Detect endpoint — clean                                                                                                                       |
| `packages/mermaid-server/src/routes/extract.ts`                | Markdown extraction — validate-flag false-positive risk here                                                                                  |
| `packages/mermaid-server/src/renderer/mermaid-bridge.ts`       | `renderCounter`/id generation, warnings construction, config sanitization                                                                     |
| `packages/mermaid-server/src/renderer/environment.ts`          | JSDOM geometry mocks — mindmap's missing-global fix belongs here                                                                              |
| `packages/mermaid-server/test/e2e/diagram-corpus.test.ts`      | 19-type corpus test — loose assertions, missing radar/mindmap                                                                                 |
| `packages/mermaid-server/ISSUE-multiline-label-measurement.md` | Prior geometry investigation, referenced by primer                                                                                            |
| `packages/mermaid-server/ISSUE-viewbox-undersize.md`           | Prior geometry investigation, referenced by primer                                                                                            |
| `docs/plans/2026-02-25-mermaid-server.md`                      | Original build plan (P0-P2 = endpoint rollout priority, NOT the same P1-P4 as this handoff's topic — don't conflate the two priority schemes) |

No cross-host or external paths — everything above is same-host, in-tree.

## Next actions

1. Live-verify timeline/kanban/quadrantChart geometry against
   `chart.chem.dev` or a local `tsx src/index.ts` instance with assertions
   tighter than the corpus test's (specific node/quadrant/event positions,
   not just "non-zero"). Resolve the primer-vs-corpus-test conflict either
   way and update `_AGENT_PRIMER.md`'s "Still genuinely broken" line.
2. Reproduce the id-mapping cache-collision finding with two live identical
   `/render` calls; if confirmed, pick a fix (see Open Questions #3) and
   file it the same way PRs #17–#19 were filed (bug issue → fix branch → PR).
3. Add the missing `htmlLabels: true` warning in `mermaid-bridge.ts`,
   following the existing `strippedConfigWarnings` pattern — smallest,
   most self-contained item in this handoff. Closes `tsk_beea3c5aadcd4c579ce8`.
4. Design a shared operation-dispatch helper for `batch.ts`/`jobs.ts` (parse/
   detect/render + warnings + error normalization in one place) before
   patching warnings-propagation into each separately.
5. Investigate mindmap's specific missing JSDOM global using the same method
   that found `screen`/`Image`/`CSSStyleSheet`.
6. Route `jobs.ts`'s 404 through `normalizeError`/`ApiError` for shape
   consistency, or explicitly document the exception in `REFERENCE.md` §9.

## Continuation hooks

```bash
# Resume in this same repo
cd /home/jgatlit/apps/mermaid/mermaid && claude
# First prompt: "Read _HANDOFF_PRIME.md and continue from Next Actions."

# Live-verify against the running deploy
curl -s https://chart.chem.dev/api/v1/health

# Re-run the diagram corpus test locally
cd /home/jgatlit/apps/mermaid/mermaid && vitest run packages/mermaid-server/test/e2e/diagram-corpus.test.ts

# Full mermaid-server suite
cd /home/jgatlit/apps/mermaid/mermaid && npx vitest run packages/mermaid-server
```

Use the `/mermaid-pro` skill for API reference/gotchas when testing rendering
behavior against `chart.chem.dev`.

## Provenance

- No prior `/find` session or synthesis existed for this exact topic — this
  bundle was composed directly from repo research in this session
  (2026-08-05), not inherited from an upstream orchestrator run.
- Verified-at: 2026-08-05T07:03Z, HEAD `b3024edd3`, `develop` branch, working
  tree clean, 37 ahead of `origin/develop`.
- `gh issue list --repo jgatlit/mermaid --state all` and
  `gh pr list --repo jgatlit/mermaid --state all` both checked — nothing
  currently open for any of these five buckets.
