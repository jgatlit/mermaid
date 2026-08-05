# Issue: Multi-line flowchart labels are never measured (node height is constant)

> ## ✅ FIXED 2026-08-04 — live on chart.chem.dev
>
> `src/renderer/environment.ts`. Four changes, 96/96 tests passing (was 87):
>
> 1. **`textRows()`** — line count now comes from direct `<tspan>` children rather
>    than `textContent.split('\n')`. Node height scales again: **54 / 78 / 102 / 150**
>    at 1 / 2 / 3 / 5 rows (was a flat 54), and width tracks the longest row instead
>    of the concatenation (`aa/bb/cc` → 66px, vs `aabbcc` → 96px).
> 2. **`geometricBounds()`** — `getBBox` on a `<g>`/`<svg>` now unions the real
>    laid-out geometry (node rects, circles, edge paths, cumulative `translate`s)
>    instead of summing text heights. This closes `ISSUE-viewbox-undersize.md` too:
>    every diagram type now reports `uncovered = 0px` against its own content.
>    Label groups still fall back to text estimation — their `<rect>` carries no
>    width/height, which is the discriminator.
> 3. **`eachPathPoint()`** — command-aware path parsing. Reading `d` as blind
>    number pairs misread `H`/`V` (one coordinate) and `A` (five non-positional
>    parameters), so a d3 axis `M0.5,6V0.5H922.5V6` produced a phantom y of 922.
>
> **4. Zero bounds for empty text and containers** — `10d78bb7b`, issue #9. An
> _empty_ edge label was reserving **more** rank space than a real one (gap 250 vs
> 178), because mermaid measures a label through its `<text>`, and empty content
> fell to the 100x100 fallback — a `translate(-50, -50)` label box where a real one
> measured 28x28. Now zeros, as a browser reports. Plain-edge gap **250 -> 150**;
> flowchart TD 7-node height **998 -> 698**; stateDiagram **737 -> 437**; flowchart
> LR width **660 -> 460**. Empty finally costs less than labelled.
>
> Measured before → after on the four real Lane B diagrams (M Hudson runbook):
> `01-access-channel-ladder` went from a viewBox of 248×1432 that **clipped 109px
> horizontally** to 500×1094 bounding its content exactly.
>
> **Committed:** `6819cbc52` and `10d78bb7b`, pushed to `fork/develop`. **96 tests**
> (was 87). Working tree clean; running process matches committed source.
>
> **Follow-on defects (Findings B and C below), status as of 2026-08-05:**
> literal `\n` still renders as a literal backslash-n — documented in
> `REFERENCE.md` now (was previously undocumented, not fixed — it's the
> correct SVG behavior, `<br/>` is the only working line-break form). 2+
> markdown list items in a wrapping label now returns **422 `RENDER_ERROR`**
> instead of 500 (`src/errors/normalize.ts`) — `/api/v1/parse` still reports
> `valid:true` for that payload, which is now documented as the endpoint's
> syntax-only contract rather than left as a silent gap (`REFERENCE.md` §2).
> `mindmap` remains broken for an unrelated reason (`Cannot read properties of
undefined (reading 'h')`) — out of scope, untouched.
>
> **Residual limitation:** `CHAR_WIDTH = 8` still approximates real font metrics, so
> the server lays out **narrower** than a browser — roughly 0.50-0.64x the
> mermaid-cli width on the Lane B set. Height overshoot is down to 1.06-1.61x.
> Complete and correctly bounded, but not pixel-equivalent to Chrome. The comparison
> is not like-for-like: mermaid-cli used `render.sh` config (`wrappingWidth: 500`,
> `nodeSpacing: 45`, `rankSpacing: 60`, Arial 15px), server probes used defaults.

**Severity**: High — silently ships overflowing diagrams; no error, no warning
**Discovered**: 2026-08-04 (M Hudson migration-runbook diagrams, "Lane B")
**Server**: chart.chem.dev · mermaid 11.12.2 · PM2 `mermaid-server` · JSDOM in-process
**Supersedes the "fixed" claim on**: jgatlit/mermaid#7 (closed 2026-02-25) — **not actually fixed**
**Related**: `ISSUE-viewbox-undersize.md` (same mock, different consequence)

---

## Summary

Every flowchart node comes back `height="54"` regardless of how many lines its label
contains, so any multi-line label overflows its box. The `viewBox` **width**, however,
grows correctly with content — which is the tell that this is _not_ "getBBox returns a
constant". `getBBox` **is** content-aware. It simply cannot see line breaks.

Consumers cannot detect this: the response is a valid 200 SVG, `/api/v1/parse` reports
`valid: true`, and the SVG is well-formed. The only symptom is text spilling outside the
node when a human finally looks at it.

---

## Root cause — one line, in two places

`src/renderer/environment.ts`:

```ts
// line 41 (leaf text/tspan branch)
const lines = text.split('\n');
// line 67 (g/svg container branch)
const lines = t.split('\n');
```

Both derive the line count from `Element.textContent.split('\n')`.

With `htmlLabels: false` (the server default — `mermaid-bridge.ts:49`), mermaid renders a
`<br/>` as **sibling `<tspan>` rows inside a single `<text>` element**. `textContent`
concatenates those rows **with no separator at all**. So:

- `lines.length` is **always 1** → `height = 1 × LINE_HEIGHT (24)` → constant node height.
- `maxLen` is the **full concatenated length** → width grows linearly with _total_
  character count, not with the longest line.

The measurement signal that _is_ correct — the `<tspan>` count — is right there on the
element and is never consulted.

### Proof (live, chart.chem.dev, 2026-08-04)

Predicted width = `maxLen × CHAR_WIDTH(8) + NODE_PADDING×2 (32) + viewBox pad (16)`.

| Label source                              | What `textContent` returns | chars | predicted | **actual viewBox** | node height |
| ----------------------------------------- | -------------------------- | ----: | --------: | -----------------: | ----------: |
| `One`                                     | `One`                      |     3 |        72 |             **72** |          54 |
| `One<br/>Two<br/>Three`                   | `OneTwoThree`              |    11 |       136 |            **136** |          54 |
| `One<br/>Two<br/>Three<br/>Four<br/>Five` | `OneTwoThreeFourFive`      |    19 |       200 |            **200** |          54 |
| `One\nTwo\nThree` (literal `\n`)          | `One\nTwo\nThree`          |    15 |       168 |            **168** |          54 |

Exact to the pixel in 4/4 cases. `foreignObject` count is 0 in all four (confirming
`htmlLabels: false` is in force and is _not_ the problem here).

Note row 4: a literal `\n` is measured as the two characters `\` and `n`, because it is
rendered as literal text — see Finding B.

### Reproduce

```bash
for n in 1 3 5; do
  case $n in
    1) L="One";;
    3) L="One<br/>Two<br/>Three";;
    5) L="One<br/>Two<br/>Three<br/>Four<br/>Five";;
  esac
  curl -s -X POST https://chart.chem.dev/api/v1/render \
    -H 'Content-Type: application/json' \
    -d "{\"diagram\":\"flowchart TD\\n  A[\\\"$L\\\"] --> B[\\\"x\\\"]\"}" \
  | grep -oE 'viewBox="[^"]*"|height="[0-9.]+"' | head -3
done
# every run: height="54"
```

---

## Proposed fix

Count rendered rows instead of splitting on `\n`. Both branches, `environment.ts`:

```ts
// Leaf text/tspan branch (~line 39)
if (tagName === 'text' || tagName === 'tspan') {
  const tspans = Array.from(this.querySelectorAll('tspan'));
  // mermaid emits one <tspan> per visual row when htmlLabels:false
  const rows = tspans.length > 0 ? tspans.map((t) => t.textContent ?? '') : text.split('\n');
  const maxLen = rows.reduce((m, l) => Math.max(m, l.length), 0);
  return { x: 0, y: 0, width: maxLen * CHAR_WIDTH, height: rows.length * LINE_HEIGHT };
}
```

…and the same `rows` derivation inside the `g`/`svg` `textEls.forEach` at ~line 64, so
`maxLen` becomes the longest **row** rather than the whole concatenation. That change
alone fixes both the constant height _and_ the over-wide boxes, since width stops
accumulating across rows.

**Risk**: low and self-limiting. Where there are no `tspan` children the behaviour is
byte-identical to today. Where there are, today's number is provably wrong.

**Verification**: the four rows in the proof table become
`height ≈ rows × 24 + padding` and width tracks the _longest_ row. Add them to
`test/renderer/environment.test.ts` as a regression fixture — the current suite has no
multi-row label case, which is why #7 could be closed while still broken.

---

## Finding B — `\n` in a node label renders as literal text

> **Documented 2026-08-05.** Not a bug — `<br/>` is the only supported
> line-break form with `htmlLabels: false`. `REFERENCE.md` now says so under
> "Line breaks in labels" (§1).

`"One\nTwo"` emits the characters `\` and `n` into the SVG rather than a line break.
Already noted at the bottom of `ISSUE-viewbox-undersize.md`; **still absent from
`REFERENCE.md`**, so every consumer rediscovers it. `<br/>` is the only line-break form
that works — and, per the issue above, the only one that then measures wrong.

Net effect for a caller today: **there is no working way to put two lines in a flowchart
node.** `\n` renders literally; `<br/>` renders but overflows.

---

## Finding C — markdown lists in a label return **500**, and `/parse` says it's valid

> **Fixed 2026-08-05.** `normalizeError` (`src/errors/normalize.ts`) now
> classifies the `splitLineToFitWidth` newline guard as `RENDER_ERROR` (422),
> not `INTERNAL_ERROR` (500) — see the `KNOWN_RENDER_INPUT_ERRORS` pattern
> list. `/api/v1/parse` deliberately still reports `valid:true` for this
> payload: exercising the label-layout path there would cost as much as
> `/render` itself, defeating the endpoint's "faster and cheaper" contract.
> Documented instead as a syntax-only contract in `REFERENCE.md` §2, with this
> case as the concrete example.

```
POST /api/v1/render
{"diagram":"flowchart TD\n  A[\"Base<br/>+ extra line<br/>+ another\"] --> B[\"x\"]"}

500 INTERNAL_ERROR: splitLineToFitWidth does not support newlines in the line
```

Characterised 2026-08-04. The trigger is narrower and broader than it first looks:

| Condition                                                                      | Result                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------- |
| **2+ markdown list items** in one label **and** label wide enough to word-wrap | **500**                                  |
| Marker is `+`, `-`, or `*`                                                     | identical failure — **not `+`-specific** |
| Exactly **one** list item, any length tested                                   | renders fine                             |
| 2+ list items but label short enough to avoid wrapping                         | renders fine                             |
| Same text without a list marker                                                | renders fine at any length               |

Mermaid's markdown label path turns 2+ items into a real list, which injects newlines
into the string; `splitLineToFitWidth` is only reached once wrapping is needed, and it
rejects newlines outright.

Two defects, not one:

1. **Misclassified as 5xx.** A malformed _label_ is client input. This should be a
   `422 PARSE_ERROR`, not a `500 INTERNAL_ERROR` — as written it will page whoever owns
   the service for a bad diagram someone typed.
2. **`/api/v1/parse` returns `{"valid": true}` for a payload that 500s on render.**
   Pre-flight validation is the documented way to check a diagram before rendering
   (`REFERENCE.md`, and the `mermaid-pro` skill both recommend it). Here it gives false
   confidence. Either `/parse` should exercise the same label path, or its contract
   should be documented as "syntax only, does not validate labels".

---

## Why this matters beyond this server

`~/.claude/skills/mermaid-pro/SKILL.md` documents chart.chem.dev as the default render
path and says nothing about any of the above. Anyone following it who puts a two-line
label in a flowchart gets a silently broken diagram. The current workaround in the field
(`Documents/aiChemist.agency/Matt-Hudson/deliverables/2026-08-04-tue/diagrams/render.sh`)
abandons the server entirely for `mermaid-cli` against a real Chrome — which works, but
means the hosted service is not usable for the diagram type people reach for most.

Fixing Finding A restores flowcharts to the hosted path and removes the need for that
local escape hatch.
