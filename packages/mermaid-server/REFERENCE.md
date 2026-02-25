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
{ diagram: string; config?: MermaidConfig; outputFormat?: "svg" | "svg-string" }
```

**Response types:**

```typescript
// outputFormat: "svg" (default) → raw SVG, Content-Type: image/svg+xml
// outputFormat: "svg-string" →
{
  svg: string;
  diagramType: string;
}
```

---

## 2. Validate Before Rendering

Check syntax without generating SVG. Faster and cheaper.

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

**Request type:**

```typescript
{ diagram: string; config?: MermaidConfig }
```

**Response type:**

```typescript
{
  valid: true;
  diagramType: string;
  config: object;
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
  "mermaidVersion": "11.12.2",
  "uptime": 641,
  "capabilities": {
    "svg": true,
    "png": false,
    "batch": true
  }
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
    { "id": "treemap" }
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
{ "flowchart": { "curve": "basis", "htmlLabels": true, "nodeSpacing": 50, "rankSpacing": 50 } }
```

**Sequence** (`sequence`):

```json
{ "sequence": { "actorMargin": 50, "mirrorActors": true, "messageAlign": "center" } }
```

**Gantt** (`gantt`):

```json
{ "gantt": { "barHeight": 20, "barGap": 4, "fontSize": 11 } }
```

### Blocked keys

These keys are silently stripped for security: `securityLevel`, `secure`, `maxTextSize`, `logLevel`, `startOnLoad`.

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

| Code                   | HTTP | When                                                                       |
| ---------------------- | ---- | -------------------------------------------------------------------------- |
| `PARSE_ERROR`          | 422  | Syntax error. `details` may include `line`, `column`, `token`, `expected`. |
| `UNKNOWN_DIAGRAM_TYPE` | 422  | Text doesn't match any diagram syntax.                                     |
| `NOT_FOUND`            | 404  | Job ID doesn't exist.                                                      |
| `INTERNAL_ERROR`       | 500  | Unexpected server error.                                                   |

---

## 10. Limits

| Constraint              | Value                   |
| ----------------------- | ----------------------- |
| Diagram text            | 50,000 characters       |
| Markdown text (extract) | 500,000 characters      |
| Batch items             | 50 per request          |
| Output formats          | SVG only (`png: false`) |

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
