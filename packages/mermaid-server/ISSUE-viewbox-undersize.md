# Issue: ViewBox Undersize for Tall Flowcharts

> ## ✅ RESOLVED 2026-08-04 — commit `6819cbc52`
>
> Fixed via **Option B**, essentially as recommended below, but implemented inside
> `environment.ts` rather than as a post-render pass in `mermaid-bridge.ts`:
> `getBBox` on a `<g>`/`<svg>` now unions the real laid-out geometry — node rects,
> circles, edge path coordinates, cumulative `translate`s — instead of summing
> descendant text heights. Label groups still text-estimate, since their `<rect>`
> carries no width/height and they are measured _during_ layout before any box
> exists. That discriminator is what makes the in-place fix work.
>
> Doing it in `environment.ts` means `getBBox` returns the truth to _mermaid itself_,
> not just to a post-processor, so no consumer needs to re-derive anything.
>
> Measured after: every diagram type bounds its own content exactly (`uncovered =
0px` for flowchart TD/LR/subgraph, sequence, class, state, gantt, pie, er). The
> example below now returns a viewBox that covers the full y-extent to 998 instead
> of stopping at 536.
>
> **Consumer follow-up:** the FLY client-side `getBBox()` recalculation described at
> the bottom of this file is now redundant and should be retired after verification —
> but check first whether it is also compensating for the DOMPurify `<br/>`
> extraction path, which is a separate problem and must stay.
>
> **Not fixed by this:** an _empty_ edge label still returns the `100x100`
> `MOCKED_BBOX` fallback, so every unlabelled edge reserves 100px of rank space it
> does not need (measured: 250px centre-to-centre gap with an empty label vs 178px
> with a real one). That, plus `CHAR_WIDTH = 8` approximating real font metrics, is
> why server layouts still run narrower and taller than a browser's. Tracked
> separately.

**Severity**: High — diagrams clipped in production consumers
**Discovered**: 2026-03-13 (FLY System Copilot integration)
**Resolved**: 2026-08-04, commit `6819cbc52`
**Superseded workaround**: Client-side `getBBox()` recalculation after SVG injection

## Problem

For `graph TD` flowcharts with 5+ nodes, the generated SVG `viewBox` is significantly smaller than the actual rendered content, causing the bottom portion of the diagram to be invisible.

### Example

```
graph TD
  A["Desire / Need"] --> B["Brain predicts<br/>neurochemical outcome"]
  B --> C["Behavior initiated"]
  C --> D{"Reward achieved?"}
  D -->|Yes| E["Pattern reinforced"]
  D -->|No| F["Pattern adjusted"]
  E --> A
  F --> A
  style D fill:#F39C12,color:#fff
```

**Generated viewBox**: `-8 -8 328 536` (height 536)
**Actual content extends to**: y=1025 (node E/F at y=998 + 27px half-height)
**Expected viewBox**: `-128 -8 543.5 1060` (approximately)

The bottom 3 nodes (diamond + 2 result nodes) and edge labels (Yes/No) are completely clipped.

## Root Cause

`environment.ts` `getBBox` mock on `<g>`/`<svg>` elements estimates dimensions by summing child `<text>` element sizes:

```typescript
textEls.forEach((el) => {
  const t = el.textContent ?? '';
  const lines = t.split('\n');
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = maxLen * CHAR_WIDTH + NODE_PADDING * 2;
  const h = lines.length * LINE_HEIGHT + NODE_PADDING;
  totalWidth = Math.max(totalWidth, w);
  totalHeight += h; // <-- additive text heights
});
```

This sums **text content heights** (~40px per node × 7 = ~280px) but Mermaid's dagre layout engine spaces nodes with ~200px vertical gaps. The actual layout height is roughly `nodeCount × (nodeHeight + verticalSpacing)` ≈ 7 × 150 = 1050px.

### What the mock doesn't account for:

1. **Inter-node spacing** — dagre adds significant vertical/horizontal padding
2. **Edge routing** — arrows extend beyond node bounds
3. **Decision diamonds** — rotated polygons occupy more space than text bbox
4. **Edge labels** — positioned between nodes, outside any text element
5. **Feedback loops** — edges that route back to earlier nodes extend the bounding box laterally

## Proposed Fix Options

### Option A: Layout-Aware Height Multiplier (Quick)

Apply a multiplier based on detected node count:

```typescript
if (tagName === 'g' || tagName === 'svg') {
  const textEls = this.querySelectorAll('text');
  const nodeEls = this.querySelectorAll('[id^="flowchart-"]');
  // ... existing text dimension calculation ...

  // Layout multiplier: dagre spaces nodes ~150px apart vertically
  const estimatedNodes = nodeEls.length || textEls.length;
  const layoutMultiplier = Math.max(2.0, estimatedNodes * 0.4);

  return {
    x: 0,
    y: 0,
    width: Math.max(totalWidth * 1.5, 400),
    height: Math.max(totalHeight * layoutMultiplier, estimatedNodes * 150),
  };
}
```

**Pros**: Simple, low risk
**Cons**: Heuristic, may overestimate for wide/shallow diagrams

### Option B: Post-Render ViewBox Correction (Robust)

After Mermaid generates the SVG, parse the output and calculate the true bounding box from actual element positions:

```typescript
// In mermaid-bridge.ts render(), after mermaid.render():
const dom = new JSDOM(result.svg);
const svg = dom.window.document.querySelector('svg');
const allElements = svg.querySelectorAll('rect, polygon, circle, ellipse, path, text');

let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
allElements.forEach((el) => {
  // Parse transform="translate(x, y)" attributes
  const transform =
    el.getAttribute('transform') || el.parentElement?.getAttribute('transform') || '';
  const match = transform.match(/translate\(([^,]+),?\s*([^)]+)\)/);
  if (match) {
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    minX = Math.min(minX, tx - 100);
    maxX = Math.max(maxX, tx + 100);
    minY = Math.min(minY, ty - 50);
    maxY = Math.max(maxY, ty + 50);
  }
});

// Also check path data points for edges
const paths = svg.querySelectorAll('path[data-points]');
paths.forEach((path) => {
  try {
    const points = JSON.parse(atob(path.getAttribute('data-points')));
    points.forEach((p) => {
      minX = Math.min(minX, p.x - 20);
      maxX = Math.max(maxX, p.x + 20);
      minY = Math.min(minY, p.y - 20);
      maxY = Math.max(maxY, p.y + 20);
    });
  } catch {}
});

const pad = 16;
svg.setAttribute(
  'viewBox',
  `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
);
```

**Pros**: Accurate for any diagram type/size, no heuristics
**Cons**: Additional DOM parse step, slightly more complex

### Option C: Enable `htmlLabels` Selectively (Enhancement)

Allow per-request `htmlLabels: true` for consumers that need rich text (line breaks, bold, etc.):

```typescript
// render route accepts config override
POST /api/v1/render
{ "diagram": "...", "config": { "htmlLabels": true } }
```

Currently `htmlLabels` is hardcoded to `false` because JSDOM doesn't fully support `<foreignObject>`. But for flowcharts specifically, HTML labels produce better text wrapping and the viewBox calculation may be more accurate since text measurements are simpler.

**Pros**: Fixes line break rendering, better text layout
**Cons**: Requires testing foreignObject in JSDOM, potential security implications

## Recommendation

**Option B** (post-render viewBox correction) is the most robust. It works for all diagram types without heuristics and doesn't require changing Mermaid's rendering mode. It can be implemented as a post-processing step in `mermaid-bridge.ts` without touching `environment.ts`.

## Current Consumer Workaround (FLY)

```javascript
// renderers.js — after injecting SVG from chart.chem.dev
requestAnimationFrame(() => {
  const bbox = svgEl.getBBox(); // browser's real getBBox
  const pad = 16;
  svgEl.setAttribute(
    'viewBox',
    `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
  );
});
```

This works but pushes the fix to every consumer. Server-side correction is preferred.

## Line Break Documentation Note

With `htmlLabels: false` (current default):

- `\n` in node labels renders as **literal `\n` text** (bug-like but technically correct for SVG)
- `<br/>` renders as a proper line break (Mermaid converts to multi-row tspan)

REFERENCE.md should document: **Use `<br/>` for line breaks in node labels, not `\n`.**
