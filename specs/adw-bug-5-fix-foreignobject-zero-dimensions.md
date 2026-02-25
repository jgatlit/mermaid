# Bug: Fix foreignObject Rendering Produces Zero-Dimension Labels

## Bug Description

The mermaid-server JSDOM rendering environment patches `getBBox()` and `getComputedTextLength()` but **does not patch `getBoundingClientRect()`**. JSDOM's default `getBoundingClientRect()` returns `{width: 0, height: 0}` for all elements. Mermaid's flowchart renderer calls `getBoundingClientRect()` on foreignObject HTML label content to size nodes — producing `foreignObject width="0" height="0"`, which cascades into broken node shapes, incorrect arrow positioning, and a collapsed viewBox.

**Symptoms:**

- Flowchart nodes rendered as ~60×30px instead of ~200×80px
- Arrows connect to wrong positions
- SVG viewBox collapsed (e.g., "-8 -8 116 116" instead of ~800×400)
- All `<foreignObject>` elements have `width="0" height="0"` attributes

**Expected behavior:**

- Flowchart nodes sized appropriately to their text content
- Arrows positioned correctly based on actual node dimensions
- SVG viewBox encompasses the full diagram
- `<foreignObject>` elements have positive width and height values

## Problem Statement

JSDOM's `getBoundingClientRect()` returns zero dimensions by default. Mermaid core uses this API to measure foreignObject HTML label content in flowcharts, class diagrams, state diagrams, and other diagram types that use HTML labels. Without a proper patch, all HTML-based labels collapse to zero size, breaking layout and rendering.

## Solution Statement

Implement a three-component fix:

1. **Patch `getBoundingClientRect` in `environment.ts`** - Add missing DOM API patch using character-width heuristic consistent with existing `getComputedTextLength` patch
2. **Default `htmlLabels: false` in `mermaid-bridge.ts`** - Prefer SVG `<text>` labels in server context as defense-in-depth
3. **Default `gantt.useWidth` in `mermaid-bridge.ts`** - Fix separate issue where gantt charts produce zero-width viewBox

## Steps to Reproduce

1. Start mermaid-server (or use deployed instance at https://chart.chem.dev)
2. Send POST request to `/api/v1/render` with flowchart diagram:
   ```bash
   curl -s -X POST 'https://chart.chem.dev/api/v1/render' \
     -H 'Content-Type: application/json' \
     -d '{"diagram": "flowchart LR\n    A[Hello World] --> B[Goodbye World]", "outputFormat": "svg-string"}'
   ```
3. Inspect returned SVG for `<foreignObject>` elements
4. Observe: `foreignObject width="0" height="0"` in all instances
5. Observe: Collapsed viewBox dimensions (e.g., "viewBox='-8 -8 116 116'")
6. Observe: Node rectangles much smaller than text content

## Root Cause Analysis

### The Missing Patch

The `environment.ts` file patches two JSDOM APIs:

- ✅ `getBBox()` → returns `{x:0, y:0, width:100, height:100}`
- ✅ `getComputedTextLength()` → returns `text.length * 8`
- ❌ `getBoundingClientRect()` → **NOT PATCHED**, returns `{width:0, height:0}`

### Mermaid Core Failure Path

```
mermaid/src/rendering-util/rendering-elements/shapes/util.ts → labelHelper()
  → div.getBoundingClientRect()          // JSDOM returns {width: 0, height: 0}
  → foreignObject.attr('width', 0)       // label container has no area
  → foreignObject.attr('height', 0)

→ Node rect sized to fit 0×0 label      // shapes are ~60×30px instead of ~200×80px
→ dagre layout uses wrong node dimensions // arrows connect to wrong positions
→ setupViewPortForSVG() → getBBox()      // viewBox calculated from broken geometry
→ SVG viewBox: "-8 -8 116 116"           // collapsed, should be ~800×400
```

### Why Config Workarounds Fail

Attempted configurations like `{ "flowchart": { "htmlLabels": false } }` are ignored because mermaid v11.x's `flowchart-v2` renderer **always uses HTML labels via foreignObject**, regardless of the `htmlLabels` config setting. This is a mermaid core design choice, but the server can work around it with the `getBoundingClientRect` patch.

## Project Map

**Primary language:** TypeScript
**Main app directory:** `packages/mermaid-server/src/`
**Test directory:** `packages/mermaid-server/test/`
**Test config:** `packages/mermaid-server/vite.config.ts`, root `vitest.workspace.js`
**Test framework:** Vitest with jsdom environment
**Package manager:** pnpm (workspace monorepo)

## Relevant Files

### Files to Modify

- **`packages/mermaid-server/src/renderer/environment.ts:25-31`**
  Add `getBoundingClientRect` patch alongside existing `getBBox` and `getComputedTextLength` patches. This is the core fix that will restore proper foreignObject dimensions.

- **`packages/mermaid-server/src/renderer/mermaid-bridge.ts:44-52`**
  Add default config for `htmlLabels: false` and `gantt.useWidth: 960`. This provides defense-in-depth and fixes gantt viewBox issue.

- **`packages/mermaid-server/test/renderer/environment.test.ts`**
  Add unit tests for `getBoundingClientRect` patch, covering single-line and multiline text scenarios.

- **`packages/mermaid-server/test/integration/render.test.ts`**
  Add integration tests asserting no zero-dimension foreignObjects and proper viewBox sizing for flowcharts and gantt charts.

- **`packages/mermaid-server/test/e2e/diagram-corpus.test.ts`**
  Extend existing corpus test to validate geometry (no zero-dimension foreignObjects, positive viewBox) across all diagram types.

### New Files

None required. All changes are modifications to existing files.

## Step by Step Tasks

### Step 1: Patch getBoundingClientRect in environment.ts

- Open `packages/mermaid-server/src/renderer/environment.ts`
- Locate the `beforeParse` callback in the `withEnvironment` function (lines 25-31)
- After the existing `getComputedTextLength` patch, add the `getBoundingClientRect` patch:
  ```typescript
  setProperty(window.Element.prototype, 'getBoundingClientRect', function (this: Element) {
    const text = this.textContent ?? '';
    const lines = text.split('\n');
    const maxLineLen = lines.reduce((max, line) => Math.max(max, line.length), 0);
    const LINE_HEIGHT = 24;
    const CHAR_WIDTH = 8; // matches getComputedTextLength heuristic
    const width = Math.max(maxLineLen * CHAR_WIDTH, 10);
    const height = Math.max(lines.length * LINE_HEIGHT, LINE_HEIGHT);
    return {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON() {
        return this;
      },
    };
  });
  ```
- The heuristic uses the same 8px character width as `getComputedTextLength`, with 24px line height for multiline text

### Step 2: Add default config in mermaid-bridge.ts

- Open `packages/mermaid-server/src/renderer/mermaid-bridge.ts`
- Locate the `constructor` method (lines 44-52)
- Update the `defaultConfig` object to include:
  ```typescript
  this.defaultConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    logLevel: 'error',
    htmlLabels: false, // Prefer SVG <text> labels in server context
    gantt: { useWidth: 960 }, // Default viewport width for server rendering
    theme: config?.theme ?? 'default',
    ...config,
  };
  ```
- The `htmlLabels: false` provides defense-in-depth for diagram types that respect this setting
- The `gantt.useWidth` fixes the separate gantt zero-width viewBox issue
- User config can still override these defaults via the `...config` spread

### Step 3: Add getBoundingClientRect unit tests

- Open `packages/mermaid-server/test/renderer/environment.test.ts`
- Add test cases for the new `getBoundingClientRect` patch:

  ```typescript
  it('patches getBoundingClientRect on HTML elements', async () => {
    await withEnvironment(() => {
      const div = global.document.createElement('div');
      div.textContent = 'Hello World';
      global.document.body.appendChild(div);
      const rect = div.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      // "Hello World" = 11 chars × 8px = 88px
      expect(rect.width).toBe(88);
      expect(rect.height).toBe(24);
    });
  });

  it('getBoundingClientRect handles multiline text', async () => {
    await withEnvironment(() => {
      const div = global.document.createElement('div');
      div.textContent = 'Line 1\nLine 2\nLine 3';
      global.document.body.appendChild(div);
      const rect = div.getBoundingClientRect();
      expect(rect.height).toBe(72); // 3 lines × 24px
      // Width should be max line length: "Line 1" = 6 chars × 8px = 48px
      expect(rect.width).toBe(48);
    });
  });

  it('getBoundingClientRect returns minimum dimensions for empty elements', async () => {
    await withEnvironment(() => {
      const div = global.document.createElement('div');
      div.textContent = '';
      global.document.body.appendChild(div);
      const rect = div.getBoundingClientRect();
      expect(rect.width).toBe(10); // Minimum width
      expect(rect.height).toBe(24); // Single line height
    });
  });
  ```

- Verify tests cover single-line text, multiline text, and empty elements

### Step 4: Add foreignObject integration tests

- Open `packages/mermaid-server/test/integration/render.test.ts`
- Add test cases for flowchart foreignObject validation:

  ```typescript
  it('flowchart foreignObjects have non-zero dimensions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart LR\n    A[Hello World] --> B[Goodbye World]',
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);

    // No zero-dimension foreignObjects
    expect(svg).not.toMatch(/foreignObject[^>]*width="0"/);
    expect(svg).not.toMatch(/foreignObject[^>]*height="0"/);

    // ViewBox should be reasonably sized (not collapsed to 116×116)
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    expect(vbMatch).toBeTruthy();
    const parts = vbMatch[1].split(' ').map(Number);
    const [, , width, height] = parts;
    expect(width).toBeGreaterThan(200);
    expect(height).toBeGreaterThan(50);
  });

  it('gantt chart has non-zero viewBox width', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram:
          'gantt\n    title Test\n    dateFormat YYYY-MM-DD\n    section Tasks\n    A :a1, 2024-01-01, 7d',
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);

    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    expect(vbMatch).toBeTruthy();
    const parts = vbMatch[1].split(' ').map(Number);
    const [, , width] = parts;
    expect(width).toBeGreaterThan(0);
  });

  it('user config can override htmlLabels default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart LR\n    A[Test] --> B[Node]',
        config: { htmlLabels: true },
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);
    // If mermaid honors htmlLabels: true, foreignObject should appear
    // (With our patch, it should have non-zero dimensions)
    if (svg.includes('foreignObject')) {
      expect(svg).not.toMatch(/foreignObject[^>]*width="0"/);
    }
  });
  ```

### Step 5: Extend e2e corpus test with geometry validation

- Open `packages/mermaid-server/test/e2e/diagram-corpus.test.ts`
- Extend the existing test loop to add geometry validation:

  ```typescript
  it(`renders ${name} diagram with valid geometry`, async () => {
    const diagram = await readFile(join(FIXTURES_DIR, `${name}.mmd`), 'utf-8');

    // Existing parse test
    const parseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram },
    });
    expect(parseRes.statusCode).toBe(200);

    // Existing render test
    const renderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram, outputFormat: 'svg-string' },
    });
    expect(renderRes.statusCode).toBe(200);
    const body = JSON.parse(renderRes.payload);
    expect(body.svg).toContain('<svg');

    // NEW: No broken foreignObjects
    if (body.svg.includes('foreignObject')) {
      expect(body.svg).not.toMatch(/foreignObject[^>]*width="0"/);
      expect(body.svg).not.toMatch(/foreignObject[^>]*height="0"/);
    }

    // NEW: ViewBox has positive dimensions
    const vbMatch = body.svg.match(/viewBox="([^"]+)"/);
    if (vbMatch) {
      const parts = vbMatch[1].split(' ').map(Number);
      expect(parts[2]).toBeGreaterThan(0); // width
      expect(parts[3]).toBeGreaterThan(0); // height
    }
  });
  ```

- This validates geometry across all 19 diagram types in the corpus

### Step 6: Run validation commands

- Execute all validation commands listed below to ensure the fix works correctly with zero regressions
- Verify all tests pass
- Confirm that flowchart diagrams render with proper foreignObject dimensions
- Confirm that gantt charts render with proper viewBox width

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions:

```bash
# Run all mermaid-server tests (uses vitest)
cd packages/mermaid-server && pnpm test

# Run full monorepo test suite (from root, uses .adw-tests.json)
pnpm ci

# Manual verification: render flowchart and inspect foreignObject
curl -s -X POST 'http://localhost:3000/api/v1/render' \
  -H 'Content-Type: application/json' \
  -d '{"diagram": "flowchart LR\n    A[Hello World] --> B[Goodbye World]", "outputFormat": "svg-string"}' \
  | jq -r '.svg' | grep -oP 'foreignObject[^>]*' | head -3

# Expected: foreignObject width and height > 0 (e.g., width="88" height="24")
# Before fix: foreignObject width="0" height="0"

# Manual verification: check viewBox dimensions
curl -s -X POST 'http://localhost:3000/api/v1/render' \
  -H 'Content-Type: application/json' \
  -d '{"diagram": "flowchart LR\n    A[Hello World] --> B[Goodbye World]", "outputFormat": "svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: viewBox with width > 200, height > 50 (e.g., viewBox="0 0 400 100")
# Before fix: viewBox="-8 -8 116 116"

# Manual verification: gantt chart viewBox
curl -s -X POST 'http://localhost:3000/api/v1/render' \
  -H 'Content-Type: application/json' \
  -d '{"diagram": "gantt\n    title Test\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 7d", "outputFormat": "svg-string"}' \
  | jq -r '.svg' | grep -oP 'viewBox="[^"]+"'

# Expected: viewBox with width > 0 (e.g., viewBox="0 0 960 268")
# Before fix: viewBox="0 0 0 268"
```

## Notes

### Affected Diagram Types

The `getBoundingClientRect` patch fixes all diagram types that use foreignObject HTML labels:

| Type               | Uses foreignObject | Fixed by Patch     | Regression Testing Required |
| ------------------ | ------------------ | ------------------ | --------------------------- |
| flowchart LR/TD/TB | Yes                | ✅                 | ✅ Required                 |
| graph LR/TD/TB     | Yes                | ✅                 | ✅ Required                 |
| sequenceDiagram    | No (SVG text)      | N/A                | ✅ Regression check         |
| gantt              | No (SVG)           | N/A (separate fix) | ✅ Required                 |
| pie                | No (SVG)           | N/A                | ✅ Regression check         |
| classDiagram       | Yes                | ✅                 | ✅ Required                 |
| stateDiagram       | Yes                | ✅                 | ✅ Required                 |
| erDiagram          | Possibly           | ✅                 | ✅ Required                 |
| mindmap            | Unknown            | ✅                 | ✅ Required                 |
| timeline           | Unknown            | ✅                 | ✅ Required                 |
| block              | Unknown            | ✅                 | ✅ Required                 |

### Why Three Components?

1. **Component 1 (getBoundingClientRect patch)** - The core fix that restores proper foreignObject dimensions for all HTML-label diagram types
2. **Component 2 (htmlLabels: false default)** - Defense-in-depth that prefers SVG text labels when the diagram type respects this config; character-width heuristics are more accurate for SVG primitives
3. **Component 3 (gantt.useWidth default)** - Fixes separate but related issue where gantt charts have no viewport width in server context

### Heuristic Consistency

The `getBoundingClientRect` patch uses the same character-width heuristic (8px per char) as the existing `getComputedTextLength` patch. This ensures consistency across both SVG text and HTML label measurement. The approximation doesn't need pixel-perfect accuracy — it needs **non-zero dimensions proportional to text content** so dagre computes reasonable layout geometry.

### User Config Override

The `htmlLabels` and `gantt.useWidth` defaults can be overridden by user-provided config in the request payload. The `...config` spread in `mermaid-bridge.ts` ensures user preferences take precedence over server defaults.

### Future-Proofing

If mermaid core adds new diagram types that use foreignObject HTML labels, they will automatically benefit from the `getBoundingClientRect` patch without requiring additional changes to mermaid-server.
