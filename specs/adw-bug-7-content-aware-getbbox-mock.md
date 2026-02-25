# Bug: Content-Aware getBBox Mock for Flowchart Layout Geometry

## Bug Description

The mermaid-server's `getBBox()` mock in `environment.ts` returns a **hardcoded constant** `{x:0, y:0, width:100, height:100}` for every SVG element, regardless of content. This breaks flowchart layout geometry because mermaid's flowchart renderer calls `getBBox()` on node groups to measure them for dagre layout, and on the root SVG to calculate the viewBox.

**Symptoms:**

- Every flowchart produces the same viewBox: `-8 -8 116 116` (constant 100×100 + 8px padding)
- Simple 2-node flowcharts have identical dimensions to complex 10-node flowcharts
- All nodes are sized as 100×100 regardless of label text length
- Layout geometry is not proportional to diagram content or complexity
- Subgraph labels are not accounted for in bounding box calculations

**Expected behavior:**

- ViewBox dimensions scale with diagram complexity
- Simple 2-node flowchart has smaller viewBox than 10-node flowchart
- Node dimensions reflect their text content size
- Root SVG bounding box aggregates all descendant text dimensions
- Flowchart layout geometry is proportional to content

## Problem Statement

JSDOM has no layout engine, so it cannot calculate accurate bounding boxes. The current `getBBox()` mock returns a constant value that works for basic rendering but breaks layout geometry calculations. Mermaid's flowchart renderer depends on `getBBox()` to measure node groups after label insertion, and to calculate the final viewBox dimensions. With constant mock values, all flowcharts collapse to the same 116×116 coordinate space regardless of complexity.

## Solution Statement

Replace the constant `getBBox()` mock with a **content-aware heuristic** that estimates dimensions from descendant text content:

1. **For `<text>` and `<tspan>` elements** - return dimensions proportional to text content (character count × 8px width, line count × 24px height)
2. **For `<g>` groups and `<svg>` root elements** - aggregate dimensions from all descendant text elements
3. **For other SVG elements** (`<rect>`, `<path>`, etc.) - return the 100×100 fallback

This approach provides **proportional geometry** rather than pixel-perfect accuracy. Flowcharts will have dimensions that scale with content, enabling correct viewBox calculation and reasonable dagre layout.

## Steps to Reproduce

1. Deploy mermaid-server or use https://chart.chem.dev
2. Render a simple 2-node flowchart:

   ```bash
   curl -s 'https://chart.chem.dev/api/v1/render' -X POST \
     -H 'Content-Type: application/json' \
     -d '{"diagram":"flowchart LR\n    A[Hi] --> B[Bye]","outputFormat":"svg-string"}' \
     | python3 -c "import sys,json,re; svg=json.load(sys.stdin)['svg']; print(re.search(r'viewBox=\"([^\"]+)\"',svg).group(1))"
   ```

   Output: `-8 -8 116 116`

3. Render a complex 10-node flowchart with subgraphs:

   ```bash
   curl -s 'https://chart.chem.dev/api/v1/render' -X POST \
     -H 'Content-Type: application/json' \
     -d '{"diagram":"flowchart LR\n    subgraph A[Group1]\n        A1[Node1]-->A2[Node2]-->A3[Node3]\n    end\n    subgraph B[Group2]\n        B1[Node4]-->B2[Node5]-->B3[Node6]\n    end\n    A-->B","outputFormat":"svg-string"}' \
     | python3 -c "import sys,json,re; svg=json.load(sys.stdin)['svg']; print(re.search(r'viewBox=\"([^\"]+)\"',svg).group(1))"
   ```

   Output: `-8 -8 116 116` (identical — proves constant mock)

4. Observe: Both diagrams produce the same viewBox dimensions despite vastly different complexity

## Root Cause Analysis

### The chicken-and-egg problem

```
1. Mermaid calls getBBox() to measure node groups for layout
2. getBBox() needs a layout engine to return correct values
3. JSDOM has no layout engine
4. Mock returns constant 100×100
5. All flowcharts collapse to 116×116 viewBox
```

### Call sites in mermaid core that use getBBox()

| Call site                               | Purpose                                  | Effect of 100×100 mock                         |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `shapes/util.ts` → `updateNodeBounds()` | Measure node group after label insertion | Every node is 100×100 regardless of label size |
| `setupViewPortForSVG.ts`                | Calculate final viewBox                  | Always `-8 -8 116 116`                         |
| Various shape handlers                  | Position labels within shapes            | Labels centered in wrong-sized containers      |
| Edge routing                            | Calculate connection points              | Arrows point to wrong positions                |

### How it interacts with PR #6

PR #6 added `htmlLabels: false` as default, which routes flowcharts through SVG `<text>` labels instead of foreignObject. The label text sizes correctly via `getComputedTextLength()` (patched to `text.length * 8`). But the **node group measurement** still uses `getBBox()`:

```
htmlLabels: false code path:
  ✅ Label text → getComputedTextLength() → correct width (e.g., 40px for "Hello")
  ❌ Node group → getBBox() → constant 100×100 → layout thinks node is 100×100
  ❌ Root SVG → getBBox() → constant 100×100 → viewBox is always 116×116
```

PR #6's `getBoundingClientRect` patch is correct but unused — it only applies to the `htmlLabels: true` (foreignObject) path, which is no longer the default.

### Why sequence, gantt, and pie are unaffected

These diagram types calculate dimensions from `getComputedTextLength()` and direct math, not `getBBox()`. Only diagram types that use dagre layout (flowchart, class, state) are affected.

## Project Map

**Primary language:** TypeScript
**Main app directory:** `packages/mermaid-server/src/`
**Test directory:** `packages/mermaid-server/test/`
**Test config:** `packages/mermaid-server/vite.config.ts`, root `vitest.workspace.js`
**Test framework:** Vitest with jsdom environment
**Package manager:** pnpm (workspace monorepo)

## Relevant Files

### Files to Modify

- **`packages/mermaid-server/src/renderer/environment.ts:11,26`**
  Replace constant `getBBox` mock (line 11 constant definition, line 26 implementation) with content-aware version that estimates dimensions from descendant text content.

- **`packages/mermaid-server/test/renderer/environment.test.ts:42-50`**
  Update existing getBBox test to validate content-aware behavior. Add tests for `<text>`, `<g>`, and `<svg>` elements with varying text content.

- **`packages/mermaid-server/test/integration/render.test.ts`**
  Add test case validating that flowchart viewBox dimensions scale with diagram complexity.

- **`packages/mermaid-server/test/e2e/diagram-corpus.test.ts:42-77`**
  Existing geometry assertions should continue to pass. The corpus test already validates positive viewBox dimensions — no changes needed, but serves as regression check.

### New Files

None required. All changes are modifications to existing files.

## Step by Step Tasks

### Step 1: Define content-aware getBBox mock constants

- Open `packages/mermaid-server/src/renderer/environment.ts`
- Locate line 11 where `MOCKED_BBOX` constant is defined
- Add additional constants for the heuristic:
  ```typescript
  const MOCKED_BBOX = { x: 0, y: 0, width: 100, height: 100 };
  const CHAR_WIDTH = 8;
  const LINE_HEIGHT = 24;
  const NODE_PADDING = 16; // padding around text in a node shape
  ```
- These constants match the existing `getComputedTextLength` heuristic (8px per char) and `getBoundingClientRect` patch (24px line height)

### Step 2: Implement content-aware getBBox logic

- In the same file, locate line 26 where `getBBox` is set
- Replace the constant return with content-aware logic:

  ```typescript
  setProperty(window.Element.prototype, 'getBBox', function (this: Element) {
    // For elements with text content, estimate dimensions from text
    const text = this.textContent ?? '';
    if (!text.trim()) {
      return { ...MOCKED_BBOX };
    }

    // Check if this is a leaf text element or a container group
    const tagName = this.tagName?.toLowerCase() ?? '';

    if (tagName === 'text' || tagName === 'tspan') {
      // Leaf text element — size proportional to content
      const lines = text.split('\n');
      const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
      return {
        x: 0,
        y: 0,
        width: maxLen * CHAR_WIDTH,
        height: lines.length * LINE_HEIGHT,
      };
    }

    if (tagName === 'g' || tagName === 'svg') {
      // Group or root — estimate from all descendant text
      const textEls = this.querySelectorAll('text, tspan');
      if (textEls.length === 0) {
        return { ...MOCKED_BBOX };
      }

      // Accumulate text content dimensions
      let totalWidth = 0;
      let totalHeight = 0;
      const seen = new Set();

      textEls.forEach((el) => {
        // Skip tspans whose parent text is already counted
        if (el.tagName === 'tspan' && seen.has(el.parentElement)) return;
        seen.add(el);

        const t = el.textContent ?? '';
        const lines = t.split('\n');
        const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
        const w = maxLen * CHAR_WIDTH + NODE_PADDING * 2;
        const h = lines.length * LINE_HEIGHT + NODE_PADDING;

        totalWidth = Math.max(totalWidth, w);
        totalHeight += h;
      });

      return {
        x: 0,
        y: 0,
        width: Math.max(totalWidth, 50),
        height: Math.max(totalHeight, 30),
      };
    }

    // Fallback for other SVG elements (rect, path, etc.)
    return { ...MOCKED_BBOX };
  });
  ```

- This implementation provides three tiers:
  1. Leaf text elements: proportional to text content
  2. Container groups: aggregate descendant text dimensions
  3. Other elements: constant fallback

### Step 3: Update environment.test.ts getBBox tests

- Open `packages/mermaid-server/test/renderer/environment.test.ts`
- Update the existing `patches getBBox on SVG elements` test (lines 42-50) to validate content-aware behavior:

  ```typescript
  it('patches getBBox on SVG elements', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const rect = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bbox = (rect as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox).toHaveProperty('width');
      expect(bbox).toHaveProperty('height');
      expect(bbox.width).toBe(100); // Fallback for non-text elements
      expect(bbox.height).toBe(100);
    });
  });
  ```

- Add new test for `<text>` element getBBox:

  ```typescript
  it('getBBox returns text-proportional dimensions for <text> elements', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = 'Hello World'; // 11 chars
      svg.appendChild(text);
      global.document.body.appendChild(svg);
      const bbox = (text as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(88); // 11 × 8
      expect(bbox.height).toBe(24); // 1 line × 24
    });
  });
  ```

- Add new test for `<g>` group getBBox:

  ```typescript
  it('getBBox returns aggregate dimensions for <g> groups', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const text1 = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text1.textContent = 'Node A';
      const text2 = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text2.textContent = 'Node B with longer text';
      g.appendChild(text1);
      g.appendChild(text2);
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      // Width should reflect the longer text (23 chars × 8 + 32 padding = 216)
      expect(bbox.width).toBeGreaterThan(200);
      // Height should accumulate both text elements
      expect(bbox.height).toBeGreaterThan(50);
    });
  });
  ```

- Add new test for empty element fallback:
  ```typescript
  it('getBBox returns fallback for elements with no text', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(100); // Fallback
      expect(bbox.height).toBe(100);
    });
  });
  ```

### Step 4: Add flowchart viewBox scaling integration test

- Open `packages/mermaid-server/test/integration/render.test.ts`
- Add new test case after the existing tests:

  ```typescript
  it('flowchart viewBox scales with diagram complexity', async () => {
    // Simple 2-node diagram
    const simple = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'flowchart LR\n    A[Hi] --> B[Bye]', outputFormat: 'svg-string' },
    });
    expect(simple.statusCode).toBe(200);
    const simpleBody = JSON.parse(simple.payload);
    const simpleVB = simpleBody.svg.match(/viewBox="([^"]+)"/)[1];
    const [, , simpleWidth, simpleHeight] = simpleVB.split(' ').map(Number);

    // Complex 6-node diagram with longer labels
    const complex = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram:
          'flowchart LR\n    A[Node One with long label] --> B[Node Two]\n    B --> C[Node Three]\n    D[Node Four] --> E[Node Five]\n    E --> F[Node Six with another long label]',
        outputFormat: 'svg-string',
      },
    });
    expect(complex.statusCode).toBe(200);
    const complexBody = JSON.parse(complex.payload);
    const complexVB = complexBody.svg.match(/viewBox="([^"]+)"/)[1];
    const [, , complexWidth, complexHeight] = complexVB.split(' ').map(Number);

    // Complex diagram should have larger viewBox than simple
    expect(complexWidth).toBeGreaterThan(simpleWidth);
    expect(complexHeight).toBeGreaterThan(simpleHeight);

    // Sanity check: neither should be the constant 116×116
    expect(simpleWidth).not.toBe(116);
    expect(complexWidth).not.toBe(116);
  });
  ```

- This test validates the core fix: viewBox dimensions now scale with content

### Step 5: Verify e2e corpus test continues to pass

- Open `packages/mermaid-server/test/e2e/diagram-corpus.test.ts`
- Review existing geometry assertions (lines 69-75)
- The existing test already validates:
  - No zero-dimension foreignObjects
  - Positive viewBox width and height
- No code changes needed — this serves as regression check
- After implementing the fix, verify all corpus tests pass

### Step 6: Run validation commands

- Execute all validation commands listed below
- Verify unit tests pass (getBBox behavior for text, groups, fallback)
- Verify integration tests pass (viewBox scaling)
- Verify e2e corpus tests pass (no regressions across diagram types)
- Manually test with curl commands to confirm viewBox dimensions scale

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions:

```bash
# From repo root, run full test suite (uses .adw-tests.json)
pnpm ci

# Run only mermaid-server tests
cd packages/mermaid-server && pnpm test

# Run specific test files
pnpm vitest run packages/mermaid-server/test/renderer/environment.test.ts
pnpm vitest run packages/mermaid-server/test/integration/render.test.ts
pnpm vitest run packages/mermaid-server/test/e2e/diagram-corpus.test.ts

# Manual verification: simple flowchart viewBox
curl -s 'http://localhost:3000/api/v1/render' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"flowchart LR\n    A[Hi] --> B[Bye]","outputFormat":"svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: viewBox dimensions NOT "116 116" (e.g., viewBox="-8 -8 200 80")
# Before fix: viewBox="-8 -8 116 116"

# Manual verification: complex flowchart viewBox
curl -s 'http://localhost:3000/api/v1/render' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"flowchart LR\n    A[Node One] --> B[Node Two]\n    C[Node Three] --> D[Node Four]\n    E[Node Five] --> F[Node Six]","outputFormat":"svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: viewBox LARGER than simple diagram (e.g., viewBox="-8 -8 400 200")
# Before fix: viewBox="-8 -8 116 116" (identical to simple)

# Manual verification: sequence diagram (regression check)
curl -s 'http://localhost:3000/api/v1/render' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"sequenceDiagram\n  Alice->>Bob: Hello","outputFormat":"svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: Valid viewBox (sequence diagrams unaffected by getBBox)
# Should render correctly as before

# Manual verification: gantt chart (regression check)
curl -s 'http://localhost:3000/api/v1/render' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"gantt\n    title Test\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 7d","outputFormat":"svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: Valid viewBox with width > 0
# Should render correctly as before (gantt uses useWidth from PR #6)
```

## Notes

### Affected Diagram Types

All diagram types that use `getBBox()` for layout are affected:

| Type               | Uses getBBox for layout | Impact                                | Testing Priority |
| ------------------ | ----------------------- | ------------------------------------- | ---------------- |
| flowchart LR/TD/TB | Yes                     | **High** — primary use case           | ✅ Critical      |
| graph LR/TD/TB     | Yes                     | **High** — same as flowchart          | ✅ Critical      |
| classDiagram       | Yes                     | **Medium** — dagre layout             | ✅ Required      |
| stateDiagram       | Yes                     | **Medium** — dagre layout             | ✅ Required      |
| sequenceDiagram    | No                      | **None** — uses getComputedTextLength | ✅ Regression    |
| gantt              | No                      | **None** — uses useWidth config       | ✅ Regression    |
| pie                | No                      | **None** — direct math                | ✅ Regression    |

### Limitations of Heuristic Approach

This is a heuristic, not a real layout engine. Known limitations:

1. **Node spacing:** dagre calculates inter-node spacing from node dimensions. The text-based estimate won't account for arrow labels, padding, or margins perfectly
2. **Subgraph sizing:** Subgraph bounding boxes depend on contained node positions, which are computed during layout. The mock can only estimate from text content
3. **Aspect ratio:** Horizontal vs vertical flowcharts will have different ideal proportions, but the mock always returns width-first estimates

These limitations produce **proportional but imprecise** layouts. Nodes may be too close or too far apart, but the geometry will scale with content rather than being constant — a major improvement over the current state.

### Why This Approach Over Alternatives

**Rejected alternative: Real layout engine**

- Would require headless Chrome or similar (massive dependency)
- Significant performance overhead for server rendering
- Overkill for the problem at hand

**Rejected alternative: Client-side rendering for flowcharts**

- Defeats the purpose of server-side rendering
- Increases client complexity
- Not a fix, just a workaround

**Chosen approach: Content-aware heuristic**

- Minimal code change (single function replacement)
- No new dependencies
- Provides proportional geometry (good enough for most use cases)
- Maintains consistency with existing heuristics (8px/char, 24px/line)

### Consistency with Existing Patches

The content-aware `getBBox` mock uses the same constants as:

- `getComputedTextLength` patch: 8px per character
- `getBoundingClientRect` patch: 24px line height

This ensures consistency across all three DOM measurement APIs.

### Future-Proofing

If mermaid core adds new diagram types that use dagre layout and `getBBox()` measurement, they will automatically benefit from the content-aware mock without requiring additional changes to mermaid-server.

### Relationship to PR #6

PR #6 fixed the foreignObject zero-dimensions issue with the `getBoundingClientRect` patch. This fix addresses the follow-up issue: constant `getBBox()` breaking flowchart layout geometry. Both fixes are part of making mermaid-server's JSDOM environment production-ready for dagre-based diagrams.
