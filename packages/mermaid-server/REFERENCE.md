# mermaid-server API Reference

**Base URLs**:

- Local: `http://localhost:3001`
- Remote: `https://chart.chem.dev`

All examples below use `$BASE`. Set it once:

```bash
# Local
BASE=http://localhost:3001

# Remote
BASE=https://chart.chem.dev
```

No authentication required. All request bodies are JSON. OpenAPI docs at `$BASE/docs`.

---

## 1. Render a Diagram

The most common operation. Send diagram text, get SVG back.

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B"}'
```

Returns raw SVG (`Content-Type: image/svg+xml`). Save to file:

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B"}' \
  -o diagram.svg
```

### Get SVG as JSON string

For programmatic use, request `svg-string` format to get the SVG wrapped in JSON:

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B",
    "outputFormat": "svg-string"
  }'
```

Response:

```json
{
  "svg": "<svg id=\"mermaid-server-1\" width=\"100%\" xmlns=\"http://www.w3.org/2000/svg\" ...>...</svg>",
  "diagramType": "flowchart-v2"
}
```

### Get PNG

Request `png` format to get a rasterized image instead of SVG. Rendered in-process by
[resvg](https://github.com/RazrFalcon/resvg) (via `@resvg/resvg-js`) directly from the
generated SVG, no headless browser involved, consistent with the rest of this server.

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B", "outputFormat": "png"}' \
  -o diagram.png
```

Returns raw PNG bytes (`Content-Type: image/png`). Disabled servers (`PNG_ENABLED=false`)
return HTTP 400 with `code: "PNG_DISABLED"` instead of silently falling back to SVG. Check
`capabilities.png` on [`/api/v1/health`](#4-check-server-status) before relying on it.

### Apply a theme

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B",
    "config": {"theme": "dark"},
    "outputFormat": "svg-string"
  }'
```

Available themes: `default`, `dark`, `forest`, `neutral`, `base`.

### Custom colors

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B-->C",
    "config": {
      "theme": "base",
      "themeVariables": {
        "primaryColor": "#1f2937",
        "primaryTextColor": "#f3f4f6",
        "lineColor": "#6b7280"
      }
    },
    "outputFormat": "svg-string"
  }'
```

### Diagram-specific settings

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B-->C-->D",
    "config": {
      "theme": "dark",
      "flowchart": {
        "curve": "basis",
        "nodeSpacing": 50,
        "rankSpacing": 50
      }
    },
    "outputFormat": "svg-string"
  }'
```

### Line breaks in labels

Use `<br/>` for line breaks inside node/edge labels — it's the only form
mermaid renders as an actual line break (`htmlLabels: false`, the server
default, has no other mechanism). A literal `\n` doesn't need to be avoided:
**flowchart labels normalize it to `<br/>` automatically**, since the two
characters `\`+`n` rendering literally in the output is never what a caller
wants. The rewrite only touches quoted label text inside flowchart diagrams —
it never touches the diagram's real newline-delimited statement structure, and
it does not apply to other diagram types (a sequenceDiagram Note or a gantt
task name keeps whatever `\n` it was given, since those aren't a documented
bug the way flowchart labels are).

This is a content rewrite, so it's never silent: the response carries a
`warnings` array (JSON output formats) or an `X-Mermaid-Warnings` header (raw
SVG/PNG) whenever it fires.

```bash
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A[\"Line one<br/>Line two\"] --> B"}'
```

```bash
# literal \n gets normalized, and the response says so
curl -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A[\"Line one\\nLine two\"] --> B", "outputFormat": "svg-string"}'
```

```json
{
  "svg": "<svg ...>...</svg>",
  "diagramType": "flowchart-v2",
  "warnings": [
    "Literal \"\\n\" in a label was converted to <br/> (the only line-break form flowchart labels render). Escape it as \"\\\\n\" if you actually want the two characters \\ and n."
  ]
}
```

Want a literal backslash followed by the letter n instead of a line break?
Escape the backslash in your JSON payload: `\\\\n`.

### Silent-stripping warnings, generally

`BLOCKED_CONFIG_KEYS` stripping (see [Configuration Reference](#8-configuration-reference))
gets the same treatment — if your `config` included one of those keys, the
response carries a warning naming it, instead of silently dropping it.

### Caching

`/render` and `/parse` share an in-memory, per-process cache. A request is
looked up by a stable hash of its `diagram` text, its (canonicalized —
object key order does not matter) `config`, and, for `/render`, its
`outputFormat` (and for `/parse`, whether `ast` was requested). Every
response carries an `X-Cache` header: `MISS` on the first request for a
given key, `HIT` on any exact repeat.

```bash
curl -sD - -o /dev/null -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B"}' | grep -i x-cache
# X-Cache: MISS

curl -sD - -o /dev/null -X POST $BASE/api/v1/render \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B"}' | grep -i x-cache
# X-Cache: HIT
```

Each cache is a bounded, in-memory LRU (`render` and `parse` are capped
independently), sized via `MERMAID_CACHE_SIZE` (default 200 entries each;
`0` disables caching). The cache is per-process — it is not shared across
PM2 workers or server restarts, and is never persisted to disk.

**Rendering is not a pure function of `(diagram, config)` for every diagram
type**, and caching assumes it is. Two things were found to break that
assumption while building this cache:

- **Gantt diagrams are wall-clock dependent, not just diagram-text
  dependent.** `gantt.todayMarker` defaults to on (only an explicit `'off'`
  disables it), and the marker's `x` position is computed from `new Date()`
  at render time, not from any date in the diagram text. A cached gantt SVG
  would silently show yesterday's "today" line on any later day, so **gantt
  output is never cached** — it always re-renders live, even on repeat
  identical requests (`X-Cache: MISS` every time). Everything else caches
  normally.
- **Some diagram types embed a monotonically-increasing or
  `Math.random()`-derived id that is not part of the diagram's visual
  content**, e.g. the server's own root `id="mermaid-server-N"`, sequence
  diagram actor ids (`actor1`, `actor2`, ...), and — genuinely random, via
  `Math.random()` in `packages/mermaid/src/utils.ts` — state diagram
  concurrency-divider ids and block diagram spacer/root ids. A cache HIT
  returns the exact bytes of whichever render produced the entry, including
  whichever of these ids that render happened to generate — geometry and
  visual content are unaffected, but this means two cached responses for the
  identical `(diagram, config)` will carry **identical** internal ids rather
  than fresh ones. This is actually more predictable than the uncached
  behavior (which mints different ids on every call for the same input), but
  if you embed the _same_ diagram+config more than once in the _same_ HTML
  document, those internal ids will now collide with each other where they
  previously wouldn't have. Namespace/rewrite ids client-side if you rely on
  per-embed uniqueness within a single page.

Error responses (422/500) are never cached.

### Error response

Invalid diagram text returns HTTP 422:

```json
{
  "error": {
    "code": "PARSE_ERROR",
    "message": "Parse error on line 2:\n...\nExpecting 'IDENTIFIER', got 'EOF'",
    "details": {
      "line": 2,
      "column": 5,
      "token": "EOF",
      "expected": ["'IDENTIFIER'", "'NEWLINE'"]
    }
  }
}
```

**Request type:**

```typescript
{ diagram: string; config?: MermaidConfig; outputFormat?: "svg" | "svg-string" | "png" }
```

**Response types:**

```typescript
// outputFormat: "svg" (default) → raw SVG, Content-Type: image/svg+xml
// outputFormat: "svg-string" →
{
  svg: string;
  diagramType: string;
}
// outputFormat: "png" → raw PNG bytes, Content-Type: image/png
// (400 PNG_DISABLED if config.png.enabled is false)
```

---

## 2. Validate Before Rendering

Check syntax without generating SVG. Faster and cheaper.

**Contract: syntax only.** `/parse` runs mermaid's grammar parser and nothing
else — it never lays out labels. A diagram can be `valid: true` here and still
fail on `/render` with a `RENDER_ERROR` (see [Error Handling](#9-error-handling))
if its _content_ can't be laid out, even though its _syntax_ is fine. Known
example: 2+ markdown list items in a node label that's wide enough to
word-wrap. There is no cheaper way to catch this — the failure only exists
once real layout runs, which is exactly what `/render` (and not `/parse`) does.
If you need a hard guarantee a diagram will render, **use [`/batch`](#6-batch-operations)
as your pre-flight**, not `/parse` — it always returns HTTP 200 with a per-item
`success` flag, so validate-then-render collapses into one call with no gap
between checking and rendering. A single-item `/batch` call is the correct way
to "just try it safely."

```bash
curl -X POST $BASE/api/v1/parse \
  -H "Content-Type: application/json" \
  -d '{"diagram": "graph TD\n    A-->B"}'
```

Response:

```json
{
  "valid": true,
  "diagramType": "flowchart-v2",
  "config": {}
}
```

The `config` field contains any configuration parsed from the diagram's frontmatter (usually empty).

Failure (HTTP 422):

```json
{
  "error": {
    "code": "PARSE_ERROR",
    "message": "Parse error on line 3:\n...\nExpecting 'IDENTIFIER', got 'EOF'",
    "details": {
      "line": 2,
      "column": 5,
      "token": "EOF",
      "expected": ["'AMP'", "'COLON'", "'NODE_STRING'"]
    }
  }
}
```

### With config overrides

Config is applied during parsing, so theme-dependent validation works:

```bash
curl -X POST $BASE/api/v1/parse \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B",
    "config": {"theme": "dark"}
  }'
```

Response:

```json
{
  "valid": true,
  "diagramType": "flowchart-v2",
  "config": {}
}
```

Note: the `config` in the response is the diagram's parsed frontmatter, not the config you sent.

### With the parsed AST (`ast: true`)

Some diagram types are backed by the Langium-based `@mermaid-js/parser` package rather
than a Jison grammar, and expose a structured AST. Add `"ast": true` to get it:

```bash
curl -X POST $BASE/api/v1/parse \
  -H "Content-Type: application/json" \
  -d '{"diagram": "pie\n\"A\": 40\n\"B\": 60", "ast": true}'
```

Response:

```json
{
  "valid": true,
  "diagramType": "pie",
  "config": {},
  "astSupported": true,
  "ast": {
    "$type": "Pie",
    "showData": false,
    "sections": [
      { "$type": "PieSection", "label": "A", "value": 40 },
      { "$type": "PieSection", "label": "B", "value": 60 }
    ]
  }
}
```

The AST is the raw Langium parse tree with its internal bookkeeping fields
(`$container`, `$containerProperty`, `$containerIndex`, `$cstNode`, `$document`) stripped
— those carry circular back-references and aren't JSON-serializable as-is. `$type` is
kept since it identifies the node kind.

For diagram types with no Langium AST (Jison-based — flowchart, sequence, class, state,
er, gantt, and most others), the response omits `ast` and reports `astSupported: false`
instead of erroring:

```json
{
  "valid": true,
  "diagramType": "flowchart-v2",
  "config": {},
  "astSupported": false
}
```

`ast`/`astSupported` are only present in the response when the request includes
`"ast": true`; omitting the flag (or passing `false`) reproduces the pre-existing response
shape exactly.

**Diagram types with a working AST**, as vendored in this repo's `@mermaid-js/parser`
(`packages/parser`, v1.2.0 — not every upstream mermaid version supports the same set):
`info`, `packet`, `pie`, `treeView`, `architecture`, `gitGraph`, `eventmodeling`, `radar`,
`railroad`, `railroadEbnf`, `railroadAbnf`, `railroadPeg`, `treemap`, `wardley`, `cynefin`.
Everything else (`flowchart`/`flowchart-v2`, `sequence`, `classDiagram`, `stateDiagram`,
`er`, `gantt`, `quadrantChart`, `sankey`, `xychart`, `block`, `kanban`, `c4`,
`requirement`, `journey`, `timeline`, `mindmap`, …) is Jison-based and always reports
`astSupported: false`.

**Request type:**

```typescript
{ diagram: string; config?: MermaidConfig; ast?: boolean }
```

**Response type:**

```typescript
{
  valid: true;
  diagramType: string;
  config: object;
  astSupported?: boolean; // present only when the request set ast: true
  ast?: object;           // present only when astSupported is true
}
```

---

## 3. Detect Diagram Type

Identify the type without parsing or rendering. Useful for routing or labeling.

```bash
curl -X POST $BASE/api/v1/detect \
  -H "Content-Type: application/json" \
  -d '{"diagram": "sequenceDiagram\n    Alice->>Bob: Hello"}'
```

Response:

```json
{
  "diagramType": "sequence"
}
```

Unrecognized syntax returns HTTP 422:

```json
{
  "error": {
    "code": "UNKNOWN_DIAGRAM_TYPE",
    "message": "No diagram type detected matching given configuration for text: ..."
  }
}
```

**Request type:**

```typescript
{
  diagram: string;
}
```

**Response type:**

```typescript
{
  diagramType: string;
}
```

---

## 4. Check Server Status

```bash
curl $BASE/api/v1/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "mermaidVersion": "11.16.0",
  "uptime": 641,
  "capabilities": {
    "svg": true,
    "png": true,
    "batch": true
  }
}
```

`mermaidVersion` is resolved from the installed `mermaid` package at request time, not a
hardcoded value — trust it. `capabilities.png` mirrors `config.png.enabled` (env
`PNG_ENABLED`, default `true`); check it before requesting `outputFormat: "png"` on
[`/api/v1/render`](#1-render-a-diagram).

**`/health` performs a real render, not just a liveness ping.** Every call renders a
trivial `flowchart TD` diagram end-to-end. If that throws — e.g. a broken dependency, a
missing module chunk — the endpoint returns **HTTP 503** with `status: "degraded"` and an
`error` field, instead of a false-positive `200 ok` while every real render is broken.
This service's failure mode has twice been "the process is alive but rendering silently
fails" — a health check that can't detect that is worse than no health check:

```json
{
  "status": "degraded",
  "version": "0.1.0",
  "mermaidVersion": "11.16.0",
  "uptime": 12,
  "error": "Cannot find module '.../dist/chunks/mermaid.core/dagre-XXXXXXXX.mjs'"
}
```

### List supported diagram types and themes

```bash
curl $BASE/api/v1/diagram-types
```

```json
{
  "diagramTypes": [
    { "id": "flowchart-elk" },
    { "id": "mindmap" },
    { "id": "architecture" },
    { "id": "c4" },
    { "id": "kanban" },
    { "id": "classDiagram" },
    { "id": "class" },
    { "id": "er" },
    { "id": "gantt" },
    { "id": "info" },
    { "id": "pie" },
    { "id": "requirement" },
    { "id": "sequence" },
    { "id": "flowchart-v2" },
    { "id": "flowchart" },
    { "id": "timeline" },
    { "id": "gitGraph" },
    { "id": "stateDiagram" },
    { "id": "state" },
    { "id": "journey" },
    { "id": "quadrantChart" },
    { "id": "sankey" },
    { "id": "packet" },
    { "id": "xychart" },
    { "id": "block" },
    { "id": "radar" },
    { "id": "treemap" },
    { "id": "ishikawa" },
    { "id": "venn" }
  ],
  "themes": ["default", "dark", "forest", "neutral", "base"]
}
```

Note: response also includes internal types `error` and `---` which should be ignored.

**Response types:**

```typescript
{ diagramTypes: Array<{id: string}>; themes: string[] }
```

---

## 5. Extract Diagrams from Markdown

Pull all ` ```mermaid ` blocks from a Markdown document.

````bash
curl -X POST $BASE/api/v1/extract \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "# Architecture\n\n```mermaid\ngraph TD\n    A-->B\n```\n\nSome text.\n\n```mermaid\nsequenceDiagram\n    Alice->>Bob: Hi\n```"
  }'
````

Response:

```json
{
  "diagrams": [
    { "index": 0, "diagram": "graph TD\n    A-->B", "line": 3 },
    { "index": 1, "diagram": "sequenceDiagram\n    Alice->>Bob: Hi", "line": 9 }
  ],
  "count": 2
}
```

### With validation

Add `"validate": true` to parse each extracted diagram:

````bash
curl -X POST $BASE/api/v1/extract \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "```mermaid\ngraph TD\n    A-->B\n```\n\n```mermaid\nbad syntax\n```",
    "validate": true
  }'
````

```json
{
  "diagrams": [
    {
      "index": 0,
      "diagram": "graph TD\n    A-->B",
      "line": 1,
      "diagramType": "flowchart-v2",
      "valid": true
    },
    {
      "index": 1,
      "diagram": "bad syntax",
      "line": 6,
      "valid": false,
      "error": "No diagram type detected matching given configuration for text: bad syntax"
    }
  ],
  "count": 2
}
```

**Request type:**

```typescript
{ markdown: string; validate?: boolean }
```

**Response type:**

```typescript
{
  diagrams: Array<{
    index: number; // 0-based position in document
    diagram: string; // extracted diagram text
    line: number; // line number in markdown
    diagramType?: string; // only with validate: true
    valid?: boolean; // only with validate: true
    error?: string; // only with validate: true, on failure
  }>;
  count: number;
}
```

---

## 6. Batch Operations

Process multiple diagrams in one request. Each item can use a different operation (`render`, `parse`, or `detect`). The response always returns HTTP 200 — individual items may succeed or fail independently.

```bash
curl -X POST $BASE/api/v1/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": "flow1", "diagram": "graph TD\n    A-->B"},
      {"id": "seq1", "diagram": "sequenceDiagram\n    Alice->>Bob: Hi"},
      {"id": "bad", "diagram": "not valid syntax"}
    ],
    "defaults": {
      "operation": "render",
      "config": {"theme": "dark"}
    }
  }'
```

Response:

```json
{
  "results": [
    {
      "id": "flow1",
      "success": true,
      "svg": "<svg>...</svg>",
      "diagramType": "flowchart-v2"
    },
    {
      "id": "seq1",
      "success": true,
      "svg": "<svg>...</svg>",
      "diagramType": "sequence"
    },
    {
      "id": "bad",
      "success": false,
      "error": {
        "code": "UNKNOWN_DIAGRAM_TYPE",
        "message": "No diagram type detected matching given configuration for text: not valid syntax",
        "statusCode": 422
      }
    }
  ],
  "summary": { "total": 3, "succeeded": 2, "failed": 1 }
}
```

Note: batch error objects include `statusCode` (unlike standalone endpoint errors).

### Mixed operations

Override the default operation per item:

```bash
curl -X POST $BASE/api/v1/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": "a", "diagram": "graph TD\n A-->B", "operation": "render"},
      {"id": "b", "diagram": "pie\n \"X\":50\n \"Y\":50", "operation": "parse"},
      {"id": "c", "diagram": "stateDiagram-v2\n [*]-->Active", "operation": "detect"}
    ]
  }'
```

### Per-item config overrides

Item-level config merges on top of defaults:

```bash
curl -X POST $BASE/api/v1/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": "light", "diagram": "graph TD\n A-->B", "config": {"theme": "default"}},
      {"id": "dark", "diagram": "graph TD\n A-->B", "config": {"theme": "dark"}}
    ],
    "defaults": {"operation": "render"}
  }'
```

**Request type:**

```typescript
{
  items: Array<{
    id?: string;
    diagram: string;
    operation?: "render" | "parse" | "detect";
    config?: MermaidConfig;
  }>; // max 50
  defaults?: {
    operation?: "render" | "parse" | "detect";
    config?: MermaidConfig;
  };
}
```

**Response type:**

```typescript
{
  results: Array<{
    id?: string;
    success: boolean;
    // render success: svg, diagramType
    // parse success: valid, diagramType
    // detect success: diagramType
    // failure: error: { code, message, statusCode, details? }
    [key: string]: unknown;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  }
}
```

---

## 7. Async Jobs

For long-running or queued work. Submit a job, get a job ID, poll for the result.

### Submit

```bash
curl -X POST $BASE/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "diagram": "graph TD\n    A-->B-->C-->D-->E",
    "operation": "render",
    "config": {"theme": "forest"}
  }'
```

Response (HTTP 202):

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "url": "/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000"
}
```

### Poll for result

```bash
curl $BASE/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000
```

While processing:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "metadata": {
    "operation": "render",
    "createdAt": "2026-02-25T10:30:00.000Z",
    "stage": "input",
    "status": "processing"
  }
}
```

When complete:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "metadata": {
    "operation": "render",
    "createdAt": "2026-02-25T10:30:00.000Z",
    "stage": "output",
    "status": "completed",
    "stagedAt": "2026-02-25T10:30:00.001Z",
    "diagramType": "flowchart-v2",
    "outputAt": "2026-02-25T10:30:00.082Z"
  },
  "result": {
    "svg": "<svg>...</svg>",
    "diagramType": "flowchart-v2"
  }
}
```

Status values: `processing` (stages: input, staged), `completed` (stage: output), `archived` (stage: archive).

### Submit and poll script

```bash
JOB_ID=$(curl -s -X POST $BASE/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"diagram": "pie\n \"A\":40\n \"B\":60"}' \
  | jq -r '.jobId')

echo "Job: $JOB_ID"

# Poll until complete
while true; do
  STATUS=$(curl -s $BASE/api/v1/jobs/$JOB_ID | jq -r '.status')
  echo "Status: $STATUS"
  [ "$STATUS" != "processing" ] && break
  sleep 1
done

# Get the result
curl -s $BASE/api/v1/jobs/$JOB_ID | jq .
```

### List all jobs

```bash
curl $BASE/api/v1/jobs
```

```json
{
  "jobs": [
    { "jobId": "550e8400-...", "stage": "output" },
    { "jobId": "660e8400-...", "stage": "input" },
    { "jobId": "770e8400-...", "stage": "archive" }
  ],
  "total": 3
}
```

Job stages: `input` (queued), `staged` (processing), `output` (complete), `archive` (archived).

### Archive a completed job

```bash
curl -X POST $BASE/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000/archive
```

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "archived"
}
```

**Request type (submit):**

```typescript
{ diagram: string; operation?: "render" | "parse" | "detect"; config?: MermaidConfig }
```

**Response types:**

```typescript
// Submit (202)
{ jobId: string; status: "processing"; url: string }

// Poll result
{
  jobId: string;
  status: "processing" | "completed" | "archived";
  metadata: {
    operation: string;
    createdAt: string;
    stage: string;
    status: string;
    stagedAt?: string;
    diagramType?: string;
    outputAt?: string;
  };
  result?: { svg?: string; diagramType?: string };
}

// List
{ jobs: Array<{ jobId: string; stage: string }>; total: number }

// Archive
{ jobId: string; status: "archived" }

// Not found (404)
{ error: { code: "NOT_FOUND"; message: string } }
```

---

## 8. Configuration Reference

The optional `config` object is accepted by `/render`, `/parse`, `/batch`, and `/jobs`. It controls mermaid's rendering behavior.

### Themes

| Theme     | Description                                           |
| --------- | ----------------------------------------------------- |
| `default` | Light with blue accents                               |
| `dark`    | Dark background, light text                           |
| `forest`  | Green tones                                           |
| `neutral` | Grayscale, high contrast                              |
| `base`    | Unstyled — use with `themeVariables` for full control |

### Theme variables (with `"theme": "base"`)

```json
{
  "theme": "base",
  "themeVariables": {
    "primaryColor": "#1f2937",
    "primaryTextColor": "#f3f4f6",
    "primaryBorderColor": "#374151",
    "lineColor": "#6b7280",
    "secondaryColor": "#f3f4f6",
    "tertiaryColor": "#e5e7eb"
  }
}
```

### Diagram-specific config keys

**Flowchart** (`flowchart`):

```json
{ "flowchart": { "curve": "basis", "nodeSpacing": 50, "rankSpacing": 50 } }
```

### `htmlLabels`

The server defaults to root-level `"htmlLabels": false` (SVG `<text>` labels —
JSDOM does not fully support `<foreignObject>`). To override, set it at the
**root** of `config`, not nested under `flowchart`:

```json
{ "htmlLabels": true, "flowchart": { "curve": "basis" } }
```

```json
{ "flowchart": { "htmlLabels": true } }
```

The second form is **silently ignored**. Mermaid's own config precedence is
`config.htmlLabels ?? config.flowchart?.htmlLabels ?? true` — this server
always sends an explicit root-level `htmlLabels` (`false` unless you override
it), so a nested `flowchart.htmlLabels` value is never consulted regardless of
what you set it to.

**Sequence** (`sequence`):

```json
{ "sequence": { "actorMargin": 50, "mirrorActors": true, "messageAlign": "center" } }
```

**Gantt** (`gantt`):

```json
{ "gantt": { "barHeight": 20, "barGap": 4, "fontSize": 11 } }
```

### Blocked keys

These keys are stripped for security: `securityLevel`, `secure`, `maxTextSize`, `logLevel`, `startOnLoad`. Not silently — if your request's `config` included any of them, the response carries a warning naming which ones (see [Line breaks in labels](#line-breaks-in-labels) for the warning delivery mechanism, shared with the `\n` normalization).

---

## 9. Error Handling

Standalone endpoints return errors as:

```json
{
  "error": {
    "code": "PARSE_ERROR",
    "message": "Parse error on line 3:\n...\nExpecting 'IDENTIFIER', got 'EOF'",
    "details": {
      "line": 2,
      "column": 5,
      "token": "EOF",
      "expected": ["'AMP'", "'COLON'", "'NODE_STRING'"]
    }
  }
}
```

Batch errors include an additional `statusCode` field in each error object.

Extract validation errors are plain strings (just the message).

| Code                   | HTTP | When                                                                                                                                                                                                                                                                  |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PARSE_ERROR`          | 422  | Syntax error. `details` may include `line`, `column`, `token`, `expected`.                                                                                                                                                                                            |
| `UNKNOWN_DIAGRAM_TYPE` | 422  | Text doesn't match any diagram syntax.                                                                                                                                                                                                                                |
| `RENDER_ERROR`         | 422  | Diagram parses fine but its label content can't be laid out (e.g. a wrapping markdown list). Not caught by `/parse` — see [Validate Before Rendering](#2-validate-before-rendering).                                                                                  |
| `NOT_FOUND`            | 404  | Job ID doesn't exist.                                                                                                                                                                                                                                                 |
| `PNG_DISABLED`         | 400  | `outputFormat: "png"` requested but `config.png.enabled` is false (`PNG_ENABLED=false`).                                                                                                                                                                              |
| `INTERNAL_ERROR`       | 500  | Unexpected server error — a genuine bug, not malformed input.                                                                                                                                                                                                         |
| `RENDER_TIMEOUT`       | 503  | A render exceeded the server's internal time budget (default 15s) and was abandoned so it couldn't block requests queued behind it. Extremely rare for legitimate diagrams — if this recurs, check for pathological input such as one very long unbroken label/token. |

---

## 10. Limits

| Constraint              | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Diagram text            | 50,000 characters                                             |
| Markdown text (extract) | 500,000 characters                                            |
| Batch items             | 50 per request                                                |
| Output formats          | SVG, PNG (gated by `config.png.enabled` / `capabilities.png`) |
| Render timeout          | 15 seconds per render (`RENDER_TIMEOUT`, HTTP 503)            |

---

## Known Limitations

- **Geometry accuracy.** As of 2026-08-04, the `viewBox` on every diagram type
  bounds its own laid-out content exactly (no clipping, no wasted space from
  empty edge labels). It is not pixel-equivalent to a real browser, though:
  text width uses a fixed `CHAR_WIDTH` approximation rather than real font
  metrics, so layouts run roughly 0.5-0.64x a browser's width for the same
  content. Node/edge positions themselves are correct — only the reported
  size of text is approximate.
- **`/parse` is syntax-only** — see [Validate Before Rendering](#2-validate-before-rendering).
  It cannot guarantee `/render` will succeed for the same diagram.
- **`htmlLabels` override** — must be set at the root of `config`, not nested
  under `flowchart`. See [Configuration Reference](#8-configuration-reference).
- **`mindmap` is currently broken** for an unrelated reason (`Cannot read
properties of undefined (reading 'h')`, HTTP 500). Tracked separately from
  the above; not a label-content or geometry issue.
- **Renders are time-boxed at 15s** (`RENDER_TIMEOUT`, HTTP 503) — added
  2026-08-05 after a single pathological input (one ~50,000-character
  unbroken label) permanently wedged the render queue in production, since
  it never crashed or threw, it just never returned. The timeout guarantees
  one bad render becomes one failed request instead of a total outage; it
  does not fix whatever caused that specific render to hang in the first
  place.

---

## Quick Reference

| Method | Path                          | Use Case                             |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/api/v1/health`              | Check server status and capabilities |
| GET    | `/api/v1/diagram-types`       | List supported types and themes      |
| POST   | `/api/v1/detect`              | Identify diagram type from text      |
| POST   | `/api/v1/parse`               | Validate syntax without rendering    |
| POST   | `/api/v1/render`              | Render diagram to SVG                |
| POST   | `/api/v1/extract`             | Pull diagrams from Markdown          |
| POST   | `/api/v1/batch`               | Process multiple diagrams at once    |
| POST   | `/api/v1/jobs`                | Submit async job                     |
| GET    | `/api/v1/jobs`                | List all jobs                        |
| GET    | `/api/v1/jobs/:jobId`         | Get job result                       |
| POST   | `/api/v1/jobs/:jobId/archive` | Archive completed job                |

---

## Diagram Syntax Quick Reference

**Flowchart**:

```
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do it]
    B -->|No| D[Skip]
```

**Sequence**:

```
sequenceDiagram
    Alice->>Bob: Request
    Bob-->>Alice: Response
```

**Class**:

```
classDiagram
    Animal <|-- Dog
    class Animal { +String name; +makeSound() }
```

**ER**:

```
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
```

**State**:

```
stateDiagram-v2
    [*] --> Active
    Active --> Inactive
    Inactive --> [*]
```

**Gantt**:

```
gantt
    title Schedule
    section Build
    Task A :a1, 2026-01-01, 30d
    Task B :after a1, 20d
```

**Pie**:

```
pie
    "A" : 40
    "B" : 60
```

**Mindmap**:

```
mindmap
  root((Project))
    Planning
    Development
    Testing
```
