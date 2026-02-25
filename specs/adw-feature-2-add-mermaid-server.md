# Feature: Mermaid Server - HTTP API for Diagram Rendering

## Feature Description

Add a new monorepo package `packages/mermaid-server/` — a Fastify HTTP API server that wraps the mermaid library to expose parse, render, detect, extract, batch, and async job endpoints for external consumers, with a filesystem-based asset pipeline. The server uses JSDOM to provide the browser-like environment mermaid needs for server-side rendering, enabling external tools (editors, CI pipelines, MCP servers, documentation generators) to submit diagram text and receive rendered SVG output via HTTP.

## User Story

As a developer building external tools (editors, CI pipelines, documentation generators)
I want an HTTP API server that can render Mermaid diagrams
So that I can integrate Mermaid diagram generation into my applications without embedding the browser-only library directly

## Problem Statement

The mermaid library is browser-only and requires a DOM environment to function. External tools that run in Node.js environments (CLI tools, CI pipelines, servers, MCP servers) cannot directly use the mermaid library to render diagrams. Currently, these tools must either:

1. Use the separate mermaid-cli package (which runs a headless browser)
2. Implement their own JSDOM-based wrapper
3. Make HTTP requests to external rendering services

There is no official HTTP API server in the mermaid monorepo that provides a clean REST interface for diagram operations.

## Solution Statement

Create `@mermaid-js/mermaid-server` — a Fastify 5 HTTP server that:

- **Replicates the JSDOM environment pattern** from `packages/mermaid/src/tests/util.ts:85-118` to provide the browser-like globals mermaid needs
- **Serializes access to mermaid's global config state** via an async mutex (promise-chain queue) to prevent race conditions
- **Exposes RESTful endpoints** with JSON Schema validation and auto-generated OpenAPI docs for parse, render, detect, extract, batch, and async job operations
- **Manages input/output lifecycle** via filesystem storage (`data/input/ → staged/ → output/ → archive/`) for async job processing
- **Provides both sync and async rendering modes** to support different use cases (quick renders vs. batch processing)

## Project Map

- **Primary Language**: TypeScript (ES2018 target)
- **Main App Directory**: `packages/mermaid-server/src/`
- **Test Directory**: `packages/mermaid-server/test/`
- **Test Config**: Uses Vitest (inherited from root `vite.config.ts` and `vitest.workspace.js`)
- **Package Manager**: pnpm workspaces
- **Build Tool**: TypeScript compiler (tsc)
- **Dev Server**: tsx (TypeScript execute)
- **Test Framework**: Vitest with jsdom environment

## Relevant Files

### Critical Reference Files (READ BEFORE IMPLEMENTATION)

- **`docs/plans/2026-02-25-mermaid-server.md`** — Complete 15-task implementation plan with full code examples (MUST READ FIRST)
- **`packages/mermaid/src/tests/util.ts:85-118`** — JSDOM environment pattern to replicate (exact global patching strategy)
- **`packages/mermaid/src/mermaidAPI.ts:534-550`** — Core mermaid API surface: render, parse, initialize, reset
- **`packages/mermaid/src/mermaid.ts`** — Public API with detectType
- **`packages/mermaid/src/config.ts`** — Global config state (why mutex is needed)
- **`packages/mermaid/src/errors.ts`** — UnknownDiagramError class
- **`CLAUDE.md`** — Project conventions, architecture, and monorepo structure
- **`README.md`** — Project overview and diagram examples
- **`.adw-tests.json`** — Test validation command (`pnpm ci`)

### Existing Monorepo Infrastructure

- **`package.json`** — Root workspace configuration
- **`pnpm-workspace.yaml`** — Workspace package definitions
- **`tsconfig.json`** — Root TypeScript configuration
- **`vite.config.ts`** — Vitest configuration
- **`vitest.workspace.js`** — Multi-project test setup
- **`packages/mermaid/package.json`** — Main mermaid library package
- **`packages/mermaid-example-diagram/`** — Reference implementation for external packages

### New Files

All files will be created in `packages/mermaid-server/`:

**Core Package Files:**

- `package.json` — Package manifest with dependencies (fastify, jsdom, mermaid workspace dependency)
- `tsconfig.json` — TypeScript configuration extending root
- `.gitignore` — Ignore data/, .test-data/, dist/, node_modules/

**Source Files:**

- `src/index.ts` — CLI entry point (loadConfig, buildApp, listen)
- `src/app.ts` — Fastify factory (cors, swagger, error handler, routes)
- `src/config.ts` — ServerConfig from env vars (PORT, HOST, themes, limits)
- `src/renderer/environment.ts` — withEnvironment<T>() JSDOM lifecycle wrapper
- `src/renderer/queue.ts` — RenderQueue promise-chain mutex
- `src/renderer/mermaid-bridge.ts` — MermaidBridge class (detect/parse/render/getDiagramTypes)
- `src/routes/health.ts` — GET /health, /diagram-types
- `src/routes/detect.ts` — POST /detect
- `src/routes/parse.ts` — POST /parse
- `src/routes/render.ts` — POST /render
- `src/routes/extract.ts` — POST /extract (regex-based mermaid block extraction from Markdown)
- `src/routes/batch.ts` — POST /batch
- `src/routes/jobs.ts` — POST/GET /jobs, GET /jobs/:id, POST /jobs/:id/archive
- `src/schemas/common.ts` — Shared JSON Schema definitions
- `src/errors/normalize.ts` — Mermaid error → ApiError normalization
- `src/storage/store.ts` — FileStore filesystem asset lifecycle manager

**Test Files:**

- `test/renderer/environment.test.ts` — Unit tests for JSDOM environment
- `test/renderer/queue.test.ts` — Unit tests for async queue
- `test/renderer/mermaid-bridge.test.ts` — Unit tests for mermaid bridge
- `test/errors/normalize.test.ts` — Unit tests for error normalization
- `test/storage/store.test.ts` — Unit tests for FileStore
- `test/integration/health.test.ts` — Integration tests for health endpoints
- `test/integration/detect.test.ts` — Integration tests for detect endpoint
- `test/integration/parse.test.ts` — Integration tests for parse endpoint
- `test/integration/render.test.ts` — Integration tests for render endpoint
- `test/integration/extract.test.ts` — Integration tests for extract endpoint
- `test/integration/batch.test.ts` — Integration tests for batch endpoint
- `test/integration/jobs.test.ts` — Integration tests for job endpoints
- `test/e2e/diagram-corpus.test.ts` — E2E test covering all 22+ diagram types
- `test/fixtures/` — Test fixtures (.mmd files per diagram type, sample.md)

## Implementation Plan

### Phase 1: Foundation - Core Infrastructure

Set up the package scaffolding, JSDOM rendering environment, async queue, mermaid bridge, and error normalization. This phase establishes the core capabilities needed for server-side rendering.

**Deliverables:**

- Package structure with dependencies installed
- JSDOM environment wrapper replicating test util pattern
- Promise-chain mutex for serialized mermaid access
- MermaidBridge class with detect/parse/render methods
- Error normalization for UnknownDiagramError and Jison parse errors

### Phase 2: Core Implementation - HTTP API Endpoints

Build the Fastify application with health, detect, parse, render, extract, and batch endpoints. This phase delivers the synchronous REST API for diagram operations.

**Deliverables:**

- Fastify app factory with CORS, Swagger, error handling
- Health and diagram-types endpoints
- Detect and parse endpoints with schema validation
- Render endpoint with SVG output (raw and JSON-wrapped)
- Extract endpoint for markdown mermaid block extraction
- Batch endpoint for multi-diagram processing
- OpenAPI documentation at /docs

### Phase 3: Integration - Async Jobs and Storage Pipeline

Add filesystem-based asset storage and async job processing system. This phase enables submit-and-poll workflows for long-running operations.

**Deliverables:**

- FileStore class managing data/input → staged → output → archive lifecycle
- Job submission endpoint (POST /api/v1/jobs)
- Job status/result endpoint (GET /api/v1/jobs/:id)
- Job listing endpoint (GET /api/v1/jobs)
- Job archival endpoint (POST /api/v1/jobs/:id/archive)
- Async job processing with error handling

## Step by Step Tasks

### 1. Read Implementation Reference

**Action:** Read the complete implementation plan at `docs/plans/2026-02-25-mermaid-server.md`

**Why:** This file contains detailed code for all 15 tasks, including exact patterns for JSDOM setup, queue implementation, mermaid bridge, and all endpoints. It serves as the authoritative implementation guide.

### 2. Create Package Scaffolding

**Action:** Create package.json, tsconfig.json, .gitignore, and src/config.ts

**Details:**

- Set up package.json with workspace dependency on mermaid, fastify, jsdom dependencies
- Configure tsconfig.json extending root with outDir: ./dist
- Create ServerConfig interface and loadConfig() function reading from env vars (PORT, HOST, LOG_LEVEL, MERMAID_THEME, etc.)
- Run `pnpm install` to resolve dependencies

**Acceptance:** `pnpm --filter @mermaid-js/mermaid-server list mermaid` shows workspace link

### 3. Implement JSDOM Rendering Environment

**Action:** Create src/renderer/environment.ts and test/renderer/environment.test.ts

**Details:**

- Replicate the exact pattern from `packages/mermaid/src/tests/util.ts:85-118`
- Create `withEnvironment<T>(fn: () => Promise<T>)` wrapper
- Patch Element.prototype.getBBox → `{x:0, y:0, width:100, height:100}`
- Patch Element.prototype.getComputedTextLength → `text.length * 8`
- Set global.window/document to JSDOM instances
- Set global.MutationObserver to undefined
- Restore globals in finally block

**Testing:** Unit tests verify globals are set inside callback, restored after, and restored even on error

### 4. Implement Async Render Queue

**Action:** Create src/renderer/queue.ts and test/renderer/queue.test.ts

**Details:**

- Implement RenderQueue class with promise-chain mutex
- Method: `async run<T>(fn: () => Promise<T>): Promise<T>`
- Chain tasks sequentially to prevent config corruption
- Propagate errors without blocking queue

**Testing:** Unit tests verify sequential execution and error propagation

### 5. Implement Mermaid Bridge

**Action:** Create src/renderer/mermaid-bridge.ts and test/renderer/mermaid-bridge.test.ts

**Details:**

- MermaidBridge class with methods: initialize(), detect(), parse(), render(), getDiagramTypes()
- Import mermaid dynamically inside withEnvironment()
- Call mermaidAPI.reset() after each operation
- Re-initialize with defaults if per-request config was applied
- Use queue.run() for all operations

**Testing:** Unit tests for detect (flowchart, sequence, unknown), parse (valid, invalid), render (flowchart, sequence, with config override)

### 6. Implement Error Normalization

**Action:** Create src/errors/normalize.ts and test/errors/normalize.test.ts

**Details:**

- normalizeError(err: unknown) → ApiError
- Handle UnknownDiagramError → 422 UNKNOWN_DIAGRAM_TYPE
- Handle Jison DetailedError (has .hash) → 422 PARSE_ERROR with line/column/expected
- Handle standard Error with parse keywords → 422 PARSE_ERROR
- Handle generic Error → 500 INTERNAL_ERROR

**Testing:** Unit tests for each error type

### 7. Create Fastify App Factory

**Action:** Create src/app.ts and src/routes/health.ts

**Details:**

- buildApp() factory: register cors, swagger, swagger-ui, error handler
- Initialize MermaidBridge
- Register health routes: GET /api/v1/health (status, version, uptime, capabilities), GET /api/v1/diagram-types (list diagram types + themes)
- Global error handler using normalizeError()

**Testing:** Integration tests for health endpoints (status 200, version present, capabilities object)

### 8. Implement Detect and Parse Routes

**Action:** Create src/routes/detect.ts, src/routes/parse.ts, src/schemas/common.ts

**Details:**

- Common schemas: diagramInput (diagram, config), errorResponse
- POST /api/v1/detect → { diagramType }
- POST /api/v1/parse → { valid, diagramType, config }
- Schema validation with 50000 char max
- Error handling with normalizeError()

**Testing:** Integration tests for detect (flowchart, sequence, unrecognized, missing body), parse (valid, invalid, config overrides)

### 9. Implement Render Route

**Action:** Create src/routes/render.ts

**Details:**

- POST /api/v1/render with outputFormat: 'svg' | 'svg-string'
- Raw SVG: Content-Type: image/svg+xml, body is SVG string
- JSON-wrapped: { svg, diagramType }
- Support config overrides (theme, etc.)
- Error handling for invalid diagrams

**Testing:** Integration tests for raw SVG, JSON-wrapped, theme override, invalid diagram, multiple diagram types

### 10. Create Test Fixtures and Diagram Corpus Test

**Action:** Create test/fixtures/\*.mmd files and test/e2e/diagram-corpus.test.ts

**Details:**

- Create .mmd files for 22+ diagram types: flowchart, sequence, class, er, gantt, git, pie, state, journey, mindmap, timeline, c4, kanban, sankey, quadrant, xychart, block, packet, requirement, info, radar, treemap
- E2E test loops through all fixtures, calls parse and render, asserts success

**Testing:** Corpus test verifies all diagram types can parse and render

### 11. Implement Extract Route

**Action:** Create src/routes/extract.ts and test/fixtures/sample.md

**Details:**

- POST /api/v1/extract with markdown text
- Regex: `/```mermaid\s*\n([\s\S]*?)```/g`
- Extract all mermaid blocks with line numbers
- Optional validate=true flag to parse each block
- Return { diagrams, count }

**Testing:** Integration tests for extraction, validation, empty markdown

### 12. Implement Batch Route

**Action:** Create src/routes/batch.ts

**Details:**

- POST /api/v1/batch with items array (max 50)
- Each item: { id?, diagram, operation?, config? }
- Support defaults: { operation, config }
- Process all items, collect results
- Return { results, summary: { total, succeeded, failed } }
- Mixed success/failure support

**Testing:** Integration tests for multiple diagrams, mixed success/failure, parse-only, max items exceeded

### 13. Implement Filesystem Asset Storage

**Action:** Create src/storage/store.ts and test/storage/store.test.ts

**Details:**

- FileStore class managing data/ subdirectories: input, staged, output, archive
- Methods: initialize(), writeInput(), writeOutput(), readJobFile(), readMetadata(), getJobStage(), moveToStage(), archive(), listJobs()
- Job lifecycle: input → staged → output → archive
- Metadata: createdAt, stage, custom fields

**Testing:** Unit tests for directory creation, input writing, stage transitions, archival, job listing

### 14. Implement Async Job Endpoints

**Action:** Create src/routes/jobs.ts

**Details:**

- POST /api/v1/jobs → { jobId, status: 'processing', url } (202)
- GET /api/v1/jobs/:id → { jobId, status, metadata, result? }
- GET /api/v1/jobs → { jobs, total }
- POST /api/v1/jobs/:id/archive → { jobId, status: 'archived' }
- Async job processing in background with processJob() function
- Error handling: failed jobs have error in metadata

**Testing:** Integration tests for job submission, retrieval, listing, archival, 404 handling

### 15. Create Entry Point and Run Final Validation

**Action:** Create src/index.ts and run full validation suite

**Details:**

- index.ts: loadConfig(), buildApp(), app.listen()
- Manual testing: start server, curl all endpoints, verify OpenAPI docs at /docs
- Run full test suite: `vitest run packages/mermaid-server/`
- Run monorepo test suite: `pnpm ci`
- Build verification: `pnpm build`

**Acceptance:** All tests pass, server starts successfully, all endpoints respond correctly, OpenAPI docs load

## Testing Strategy

### Unit Tests

**Coverage:** Core components tested in isolation

- JSDOM environment wrapper (globals set/restored, getBBox patched)
- Async queue (sequential execution, error propagation)
- Mermaid bridge (detect, parse, render with config)
- Error normalization (all error types mapped correctly)
- FileStore (CRUD operations, stage transitions, job lifecycle)

**Framework:** Vitest with jsdom environment

### Integration Tests

**Coverage:** HTTP endpoints tested via Fastify inject

- Health endpoints (status, diagram types)
- Detect endpoint (various diagram types, unknown diagrams)
- Parse endpoint (valid/invalid diagrams, config overrides)
- Render endpoint (SVG output formats, themes, error handling)
- Extract endpoint (markdown extraction, validation)
- Batch endpoint (multiple diagrams, mixed results, limits)
- Job endpoints (submit, retrieve, list, archive, 404)

**Framework:** Vitest with Fastify inject for fast HTTP testing

### E2E Tests

**Coverage:** Full diagram type coverage

- Diagram corpus test: all 22+ diagram types parse and render successfully
- End-to-end workflow: submit diagram → get SVG output → verify valid SVG markup

### Edge Cases

- Empty diagram text → 400 or 422
- Diagram exceeding max text size (50000 chars) → 400
- Batch exceeding max items (50) → 400
- Unknown diagram type → 422 UNKNOWN_DIAGRAM_TYPE
- Parse error with Jison details → 422 PARSE_ERROR with line/column info
- Concurrent render requests → handled by queue, no config corruption
- Job not found → 404
- Markdown with no mermaid blocks → empty results, count: 0
- Invalid config overrides → accepted (mermaid will error if truly invalid)

## Acceptance Criteria

- [ ] Package `packages/mermaid-server/` exists as pnpm workspace package
- [ ] `pnpm --filter @mermaid-js/mermaid-server dev` starts server on port 3000
- [ ] All 11 endpoints return correct status codes and response shapes:
  - GET /api/v1/health → 200 { status, version, uptime, capabilities }
  - GET /api/v1/diagram-types → 200 { diagramTypes, themes }
  - POST /api/v1/detect → 200 { diagramType } or 422 error
  - POST /api/v1/parse → 200 { valid, diagramType, config } or 422 error
  - POST /api/v1/render → 200 SVG or { svg, diagramType } or 422 error
  - POST /api/v1/extract → 200 { diagrams, count }
  - POST /api/v1/batch → 200 { results, summary }
  - POST /api/v1/jobs → 202 { jobId, status, url }
  - GET /api/v1/jobs → 200 { jobs, total }
  - GET /api/v1/jobs/:id → 200 { jobId, status, result } or 404
  - POST /api/v1/jobs/:id/archive → 200 { jobId, status } or 404
- [ ] SVG output contains valid `<svg>` markup for all 22+ diagram types
- [ ] Invalid diagrams return 422 with structured error (code, message, details)
- [ ] Batch endpoint handles mixed success/failure, max 50 items
- [ ] Job endpoints support async submit → poll → archive lifecycle
- [ ] FileStore creates and manages data/{input,staged,output,archive}/ directories
- [ ] OpenAPI docs accessible at /docs with all endpoints documented
- [ ] All unit and integration tests pass: `vitest run packages/mermaid-server/`
- [ ] Monorepo test suite passes with zero regressions: `pnpm ci`
- [ ] `pnpm build` succeeds with no errors from the new package
- [ ] Manual curl tests for all endpoints return expected responses

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

````bash
# Install dependencies
pnpm install

# Run mermaid-server unit and integration tests
vitest run packages/mermaid-server/

# Run monorepo test suite (zero regressions required)
pnpm ci

# Build all packages including mermaid-server
pnpm build

# Start dev server
pnpm --filter @mermaid-js/mermaid-server dev &
SERVER_PID=$!
sleep 3

# Test health endpoint
curl http://localhost:3000/api/v1/health

# Test diagram-types endpoint
curl http://localhost:3000/api/v1/diagram-types

# Test detect endpoint
curl -X POST http://localhost:3000/api/v1/detect \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"graph TD; A-->B"}'

# Test parse endpoint
curl -X POST http://localhost:3000/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"graph TD; A-->B"}'

# Test render endpoint (raw SVG)
curl -X POST http://localhost:3000/api/v1/render \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"graph TD; A-->B"}'

# Test render endpoint (JSON-wrapped)
curl -X POST http://localhost:3000/api/v1/render \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"graph TD; A-->B","outputFormat":"svg-string"}'

# Test extract endpoint
curl -X POST http://localhost:3000/api/v1/extract \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# Doc\n\n```mermaid\ngraph TD; A-->B\n```","validate":true}'

# Test batch endpoint
curl -X POST http://localhost:3000/api/v1/batch \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"diagram":"graph TD;A-->B"},{"diagram":"sequenceDiagram\nAlice->>Bob:Hi"}]}'

# Test job submission and retrieval
JOB_RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/jobs \
  -H 'Content-Type: application/json' \
  -d '{"diagram":"graph TD; A-->B","operation":"render"}')
JOB_ID=$(echo $JOB_RESPONSE | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
sleep 1
curl http://localhost:3000/api/v1/jobs/$JOB_ID

# Test job listing
curl http://localhost:3000/api/v1/jobs

# Cleanup
kill $SERVER_PID

# Verify OpenAPI docs are accessible (manual browser check)
# http://localhost:3000/docs
````

**Primary Validation Command** (from .adw-tests.json):

```bash
pnpm ci
```

This command must execute without errors to ensure zero regressions across the entire monorepo.

## Notes

### Architecture Decisions

1. **JSDOM over Puppeteer/Playwright for SVG rendering:** JSDOM is lightweight and sufficient for SVG generation. Puppeteer/Playwright are only needed for PNG rasterization (deferred to future work).

2. **Promise-chain mutex over worker threads:** Mermaid's global config state and D3 dependencies make it unsuitable for worker threads. A single-threaded queue is simpler and sufficient for typical load.

3. **Filesystem storage over database:** For MVP, filesystem provides adequate persistence for job lifecycle. Can be swapped for database in future.

4. **Fastify over Express:** Fastify provides built-in schema validation, OpenAPI generation, and better TypeScript support.

### Future Enhancements

- **PNG rendering:** Add Playwright-based PNG export endpoint (POST /api/v1/render/png) with browser page pool
- **Job cleanup:** Add TTL-based archival and deletion of old jobs
- **Rate limiting:** Add per-IP rate limits to prevent abuse
- **Authentication:** Add API key or OAuth support for production deployments
- **Metrics:** Add Prometheus metrics for request counts, render times, error rates
- **Caching:** Add Redis-based caching for frequently rendered diagrams
- **Horizontal scaling:** Document how to run multiple server instances with shared job storage

### Dependencies Added

**Production:**

- fastify: ^5.3.3
- @fastify/cors: ^11.0.0
- @fastify/swagger: ^9.6.0
- @fastify/swagger-ui: ^5.2.2
- jsdom: ^26.1.0
- mermaid: workspace:\*

**Development:**

- @types/jsdom: ^21.1.7
- typescript: ~5.8.0
- tsx: ^4.20.6
- vitest: ^3.2.4

### Project Conventions Followed

- TypeScript strict mode, ES2018 target
- Prettier: single quotes, 100 char width, 2-space indent
- ESLint with typescript-eslint
- Vitest for testing with jsdom environment
- Git commits with conventional commit messages
- Changesets for versioning (add changeset after implementation)

### Reference Implementation

The complete step-by-step implementation with full code for all 15 tasks is in `docs/plans/2026-02-25-mermaid-server.md`. This plan should be read first and used as the authoritative guide during implementation.
