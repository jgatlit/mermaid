import type { MermaidConfig } from 'mermaid';
import { parse as parseLangiumAst } from '@mermaid-js/parser';
import { withEnvironment } from './environment.js';
import { RenderQueue } from './queue.js';

export interface ParseResult {
  diagramType: string;
  config: MermaidConfig;
  ast?: unknown;
  astSupported?: boolean;
  warnings?: string[];
}

export interface ParseOptions {
  ast?: boolean;
}

// Mirrors the diagram-type keys @mermaid-js/parser's `initializers` map accepts
// (packages/parser/src/language/index.ts) — that map isn't exported, so this list
// has to be kept by hand. Every entry equals both the diagram's detector `id` in
// mermaid core and the diagramType mermaid.parse() returns, confirmed by direct probe
// against the vendored parser (v1.2.0): all 15 round-trip through parseLangiumAst.
type AstDiagramType =
  | 'info'
  | 'packet'
  | 'pie'
  | 'treeView'
  | 'architecture'
  | 'gitGraph'
  | 'eventmodeling'
  | 'radar'
  | 'railroad'
  | 'railroadEbnf'
  | 'railroadAbnf'
  | 'railroadPeg'
  | 'treemap'
  | 'wardley'
  | 'cynefin';

const AST_SUPPORTED_DIAGRAM_TYPES: ReadonlySet<AstDiagramType> = new Set([
  'info',
  'packet',
  'pie',
  'treeView',
  'architecture',
  'gitGraph',
  'eventmodeling',
  'radar',
  'railroad',
  'railroadEbnf',
  'railroadAbnf',
  'railroadPeg',
  'treemap',
  'wardley',
  'cynefin',
]);

function isAstSupportedDiagramType(diagramType: string): diagramType is AstDiagramType {
  return (AST_SUPPORTED_DIAGRAM_TYPES as ReadonlySet<string>).has(diagramType);
}

// Langium AstNode fields carry parent back-references ($container) and a CST
// tree ($cstNode) that both cycle back on themselves — JSON.stringify throws on
// the raw node. $type is kept (it's the useful discriminator); the rest is
// parser-internal bookkeeping no API consumer needs.
const AST_INTERNAL_KEYS = new Set([
  '$container',
  '$containerProperty',
  '$containerIndex',
  '$cstNode',
  '$document',
]);

function sanitizeAst(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAst);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (!AST_INTERNAL_KEYS.has(key)) {
        out[key] = sanitizeAst(val);
      }
    }
    return out;
  }
  return value;
}

export interface RenderResult {
  svg: string;
  diagramType: string;
  warnings?: string[];
}

interface MermaidModule {
  default: {
    initialize: (config: MermaidConfig) => void;
    detectType: (text: string) => string;
    parse: (text: string) => Promise<ParseResult>;
    render: (id: string, text: string) => Promise<RenderResult>;
    mermaidAPI: { reset: () => void };
    getRegisteredDiagramsMetadata: () => { id: string }[];
  };
}

const BLOCKED_CONFIG_KEYS = ['securityLevel', 'secure', 'maxTextSize', 'logLevel', 'startOnLoad'];

// Stripping used to be silent — same class of bug as the literal-\n case below:
// the server rewrites caller intent without telling anyone. Reporting which keys
// were actually present (not the full blocked list) keeps the common case, where
// none of them were sent, warning-free.
function sanitizeConfig(config: MermaidConfig): { config: MermaidConfig; strippedKeys: string[] } {
  const sanitized = { ...config };
  const strippedKeys: string[] = [];
  for (const key of BLOCKED_CONFIG_KEYS) {
    if (key in (sanitized as Record<string, unknown>)) {
      delete (sanitized as Record<string, unknown>)[key];
      strippedKeys.push(key);
    }
  }
  return { config: sanitized, strippedKeys };
}

// Matches double-quoted string spans so the \n->  <br/> rewrite below stays
// inside label text and never touches the diagram's real newline-delimited
// statement structure (a literal \n is the two characters backslash+n, not an
// actual newline byte — see ISSUE-multiline-label-measurement.md Finding B).
const QUOTED_STRING = /"([^"]*)"/g;

/**
 * Flowchart node/edge labels never interpret a literal `\n` as a line break —
 * it renders as the two characters `\` and `n` (htmlLabels:false; `<br/>` is
 * the only working line-break form). A blanket `text.replace(/\\n/g, ...)`
 * over the whole diagram would also rewrite sequenceDiagram Notes and gantt
 * task names, where the same bytes may be intentional or have different
 * semantics — so this only touches quoted-string spans, and only when the
 * diagram is a flowchart.
 */
function normalizeFlowchartLabelBreaks(
  text: string,
  diagramType: string
): { text: string; changed: boolean } {
  if (!diagramType.startsWith('flowchart')) {
    return { text, changed: false };
  }
  let changed = false;
  const normalized = text.replace(QUOTED_STRING, (match, inner: string) => {
    if (!inner.includes('\\n')) {
      return match;
    }
    changed = true;
    return `"${inner.replace(/\\n/g, '<br/>')}"`;
  });
  return { text: normalized, changed };
}

const LITERAL_NEWLINE_WARNING =
  'Literal "\\n" in a label was converted to <br/> (the only line-break form flowchart labels render). Escape it as "\\\\n" if you actually want the two characters \\ and n.';

// htmlLabels:true renders labels as <foreignObject><div>...</div></foreignObject>.
// That's valid, well-formed SVG - but when the response is loaded via <img> (the
// majority embedding pattern for markdown/docs), the browser's <img> decoder does
// not execute foreignObject's embedded HTML, so the label text is invisible with
// no error. Every other silent-rewrite case here already warns; this was the one
// gap (see mermaid-server-deploy-hazards.md-adjacent handoff finding, 2026-08-05).
const HTML_LABELS_WARNING =
  'htmlLabels is enabled: labels render as <foreignObject> HTML, which shows no visible text when this SVG is loaded via <img> (the common embedding pattern for markdown/docs). Leave htmlLabels unset/false if the output will be embedded that way.';

function strippedConfigWarnings(strippedKeys: string[]): string[] {
  return strippedKeys.map(
    (key) => `Config key "${key}" was removed - not permitted in this server context.`
  );
}

let renderCounter = 0;

function nextRenderId(): string {
  return `mermaid-server-${++renderCounter}`;
}

// Every element mermaid emits inside a rendered SVG is prefixed with the root
// id passed to mermaid.render() - not just the root <svg id="...">, but style
// selectors, markers, node/edge ids, and defs. The id is never split or
// transformed en route, so it always appears as this exact literal substring;
// replacing every occurrence of it is sufficient to re-key a whole cached SVG
// under a fresh id without a full re-render.
const SVG_ROOT_ID = /^<svg[^>]*\sid="([^"]+)"/;

// render.ts's cache stores one RenderResult per (diagram, config, outputFormat)
// key and returns it verbatim on every HIT - including the `mermaid-server-N`
// id baked into the SVG at the original MISS. Two callers who render the same
// diagram+config and embed both responses on one page would get a duplicate
// DOM id. Cache HITs route through this first, swapping in a fresh
// process-unique id (same counter as a real render, so ids never collide with
// each other) so every response - cached or not - is safe to embed alongside
// any other.
export function rewriteRenderId(result: RenderResult): RenderResult {
  const match = SVG_ROOT_ID.exec(result.svg);
  if (!match) {
    return result;
  }
  const [, oldId] = match;
  const newId = nextRenderId();
  return { ...result, svg: result.svg.split(oldId).join(newId) };
}

export class MermaidBridge {
  private queue = new RenderQueue();
  private mermaidModule: MermaidModule | null = null;
  private initialized = false;
  private defaultConfig: MermaidConfig;

  constructor(config?: Partial<MermaidConfig>) {
    this.defaultConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      logLevel: 'error',
      htmlLabels: false, // Prefer SVG <text> labels in server context
      gantt: { useWidth: 960 }, // Default viewport width for server rendering
      theme: config?.theme ?? 'default',
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.queue.run(() =>
      withEnvironment(async () => {
        this.mermaidModule = await import('mermaid');
        this.mermaidModule.default.initialize(this.defaultConfig);
        this.initialized = true;
      })
    );
  }

  private getMermaid() {
    if (!this.mermaidModule) {
      throw new Error('MermaidBridge not initialized. Call initialize() first.');
    }
    return this.mermaidModule.default;
  }

  async detect(text: string): Promise<string> {
    return this.queue.run(() =>
      withEnvironment(() => {
        const mermaid = this.getMermaid();
        return mermaid.detectType(text);
      })
    );
  }

  async parse(text: string, config?: MermaidConfig, options?: ParseOptions): Promise<ParseResult> {
    return this.queue.run(() =>
      withEnvironment(async () => {
        const mermaid = this.getMermaid();
        const warnings: string[] = [];
        let strippedKeys: string[] = [];
        let effectiveConfig: MermaidConfig = this.defaultConfig;
        try {
          if (config) {
            const sanitized = sanitizeConfig(config);
            strippedKeys = sanitized.strippedKeys;
            effectiveConfig = { ...this.defaultConfig, ...sanitized.config };
            mermaid.initialize(effectiveConfig);
          }
          const diagramType = mermaid.detectType(text);
          const normalized = normalizeFlowchartLabelBreaks(text, diagramType);
          if (normalized.changed) {
            warnings.push(LITERAL_NEWLINE_WARNING);
          }
          warnings.push(...strippedConfigWarnings(strippedKeys));
          if (effectiveConfig.htmlLabels) {
            warnings.push(HTML_LABELS_WARNING);
          }

          const result = await mermaid.parse(normalized.text);
          const withWarnings = warnings.length > 0 ? { ...result, warnings } : result;
          if (!options?.ast) {
            return withWarnings;
          }
          const astSupported = isAstSupportedDiagramType(result.diagramType);
          return {
            ...withWarnings,
            astSupported,
            ast: astSupported
              ? sanitizeAst(await parseLangiumAst(result.diagramType, normalized.text))
              : undefined,
          };
        } finally {
          mermaid.mermaidAPI.reset();
          if (config) {
            mermaid.initialize(this.defaultConfig);
          }
        }
      })
    );
  }

  async render(text: string, config?: MermaidConfig): Promise<RenderResult> {
    return this.queue.run(() =>
      withEnvironment(async () => {
        const mermaid = this.getMermaid();
        const id = nextRenderId();
        const warnings: string[] = [];
        let strippedKeys: string[] = [];
        let effectiveConfig: MermaidConfig = this.defaultConfig;
        try {
          if (config) {
            const sanitized = sanitizeConfig(config);
            strippedKeys = sanitized.strippedKeys;
            effectiveConfig = { ...this.defaultConfig, ...sanitized.config };
            mermaid.initialize(effectiveConfig);
          }
          const diagramType = mermaid.detectType(text);
          const normalized = normalizeFlowchartLabelBreaks(text, diagramType);
          if (normalized.changed) {
            warnings.push(LITERAL_NEWLINE_WARNING);
          }
          warnings.push(...strippedConfigWarnings(strippedKeys));
          if (effectiveConfig.htmlLabels) {
            warnings.push(HTML_LABELS_WARNING);
          }

          const result = await mermaid.render(id, normalized.text);
          return {
            svg: result.svg,
            diagramType: result.diagramType,
            ...(warnings.length > 0 ? { warnings } : {}),
          };
        } finally {
          mermaid.mermaidAPI.reset();
          if (config) {
            mermaid.initialize(this.defaultConfig);
          }
        }
      })
    );
  }

  async getDiagramTypes(): Promise<{ id: string }[]> {
    return this.queue.run(() =>
      withEnvironment(() => {
        const mermaid = this.getMermaid();
        return mermaid.getRegisteredDiagramsMetadata();
      })
    );
  }
}
