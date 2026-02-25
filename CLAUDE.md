# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mermaid is a JavaScript library that renders Markdown-inspired text definitions into SVG diagrams. It is a **browser-only library** — CLI rendering (PNG, PDF) lives in the separate [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) repo.

Current version: **11.12.2** (published package), monorepo root is v10.2.4.

## Monorepo Structure

Managed with **pnpm workspaces** (`pnpm@10.4.1`). Packages:

| Package | Purpose |
|---------|---------|
| `mermaid` | Main library — all diagram types, rendering, config |
| `@mermaid-js/parser` | Langium-based parser (newer diagrams) |
| `mermaid-zenuml` | ZenUML diagram plugin |
| `mermaid-layout-elk` | ELK layout engine for flowcharts |
| `mermaid-layout-tidy-tree` | Tidy tree layout algorithm |
| `mermaid-example-diagram` | Reference implementation for external diagrams |
| `tiny` | Minimal mermaid build (excludes large features) |
| `examples` | Integration examples |

## Common Commands

```bash
# Install dependencies
pnpm install

# Build everything (esbuild + TypeScript declarations)
pnpm build

# Build only the mermaid package
pnpm build:mermaid

# Dev server (esbuild-based, uses demos/ HTML files)
pnpm dev

# Dev server (Vite-based)
pnpm dev:vite

# Run unit tests
pnpm ci                        # or: vitest run

# Run a single test file
vitest run packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# E2E tests (starts dev server + Cypress)
pnpm e2e

# Interactive Cypress
pnpm cypress:open

# Lint (ESLint + Prettier + Jison linter)
pnpm lint

# Auto-fix lint issues
pnpm lint:fix

# Build docs (VitePress)
pnpm --filter mermaid docs:dev

# Generate Langium parser
pnpm --filter @mermaid-js/parser langium:generate
```

## Build Outputs

The esbuild pipeline (`.esbuild/build.ts`) produces multiple formats per package:
- `*.core.mjs` — ESM with externalized dependencies (used by bundlers)
- `*.esm.mjs` — ESM with bundled dependencies
- `*.min.mjs` — Minified ESM
- `mermaid.js` / `mermaid.min.js` — IIFE for `<script>` tag usage
- `mermaid.tiny.min.js` — IIFE excluding large features (ELK, mindmap, architecture)

The `injected.includeLargeFeatures` compile-time flag controls whether ELK layout, mindmap, and architecture diagrams are included.

## Architecture

### Diagram Lifecycle

Every diagram type follows this pattern:

1. **Detector** (`*Detector.ts`) — identifies diagram type from text (e.g., `graph TD`, `sequenceDiagram`)
2. **Parser** — parses text into structured data (Jison `.jison` files for legacy, Langium for newer diagrams)
3. **DB** (`*Db.ts`) — stores parsed state, provides accessors for renderer
4. **Renderer** (`*Renderer.ts`) — generates SVG using D3.js
5. **Styles** (`styles.ts`) — theme-aware CSS generation

Diagrams are registered in `packages/mermaid/src/diagram-api/diagram-orchestration.ts` via `registerLazyLoadedDiagrams()`. Detector ordering matters — first match wins.

### Two Parser Systems

- **Jison** (legacy): `.jison` grammar files in each diagram's `parser/` directory. Compiled via custom esbuild/vite plugins.
- **Langium** (newer): Grammar in `packages/parser/`. Used by newer diagrams (block, architecture, kanban, etc.). Run `langium generate` to regenerate.

### Rendering Pipeline

```
Text → detectType() → Diagram.parse() → DB populated → Renderer.draw() → SVG string
```

The public API (`mermaid.render()`) returns `{ svg, diagramType, bindFunctions }`. SVG is sanitized with DOMPurify in strict/sandbox security modes.

### Layout Engines

- **Dagre** (default) — `dagre-d3-es` for hierarchical graph layout
- **ELK** — via `mermaid-layout-elk` package, loaded dynamically
- **Cytoscape** — used for architecture diagrams (`cytoscape-fcose`)
- **Tidy Tree** — via `mermaid-layout-tidy-tree` package

Layout algorithms are pluggable via `registerLayoutLoaders()`.

### Theme System

Five built-in themes in `packages/mermaid/src/themes/`:
- `default`, `dark`, `forest`, `neutral`, `base` (fully customizable via theme variables)

Each diagram's `styles.ts` receives theme variables and returns CSS strings.

### Configuration

- Schema defined in `packages/mermaid/src/schemas/*.schema.yaml`
- TypeScript types auto-generated: `pnpm --filter mermaid types:build-config`
- Runtime config managed by `packages/mermaid/src/config.ts` (site-level, diagram-level, directive-level)

### Plugin System

External diagrams implement `ExternalDiagramDefinition` and are registered via `mermaid.registerExternalDiagrams()`. The `mermaid-example-diagram` package serves as the reference implementation.

## Supported Diagram Types (25)

architecture, block, c4, class, er, flowchart, gantt, git, info, kanban, mindmap, packet, pie, quadrant-chart, radar, requirement, sankey, sequence, state, timeline, treemap, user-journey, xychart, zenuml (plugin), error (internal)

## Testing

- **Unit tests**: Vitest with jsdom environment, globals enabled. Tests colocated as `*.spec.ts` files.
- **E2E tests**: Cypress in `cypress/` directory. Visual regression via Argos CI and Applitools.
- **Vitest config**: `vite.config.ts` (root) + `vitest.workspace.js` for multi-project setup.

## Code Style

- TypeScript strict mode, ES2018 target
- Prettier: single quotes, 100 char width, 2-space indent, trailing commas (es5)
- ESLint flat config with typescript-eslint, CSpell (spell checking), unicorn, lodash, jsdoc plugins
- Pre-commit hooks via Husky + lint-staged
- Changesets for versioning (`pnpm changeset`)
