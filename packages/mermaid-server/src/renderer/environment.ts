import { JSDOM } from 'jsdom';

const BASE_HTML = `
  <html lang="en">
    <body id="mermaid-server">
      <svg id="svg"/>
    </body>
  </html>
`;

const MOCKED_BBOX = { x: 0, y: 0, width: 100, height: 100 };
const CHAR_WIDTH = 8;
const LINE_HEIGHT = 24;
const NODE_PADDING = 16; // padding around text in a node shape

function setProperty(obj: Record<string, unknown>, key: string, value: unknown): void {
  obj[key] = value;
}

// c4Renderer.ts reads screen.availWidth unconditionally to bound its shape
// grid before wrapping to a new row. jsdom's own `window.screen.availWidth`
// defaults to 0 (no real display), which is worse than not having `screen`
// at all: rather than a clean error, it would silently force every C4 shape
// onto its own row (any width check `>= 0` trips immediately). This mocks a
// generous desktop-viewport width instead, so width-based wrapping only
// kicks in where a real browser's would, leaving C4's own shape-count-per-row
// config as the effective limit — matching this server's existing pattern of
// overriding jsdom defaults with sensible values rather than trusting them
// (see MOCKED_BBOX, gantt's useWidth in mermaid-bridge.ts).
const MOCK_SCREEN = { availWidth: 1920 };

// imageSquare.ts (flowchart `img`-shape nodes) does `img.src = node.img;
// await img.decode()` where `node.img` is arbitrary, unauthenticated diagram
// content. jsdom's real Image, combined with `resources: 'usable'` below,
// would actually fetch that URL over the network — an SSRF vector (server
// fetches whatever URL a caller's diagram names) and a new render-hang class
// on top of the one RenderQueue's timeout already guards against (JSDOM's
// resource fetch has no timeout of its own). This server has no real image
// pipeline anyway — text width is already a CHAR_WIDTH approximation, not
// real font metrics — so a synchronous, non-fetching mock is both the safer
// and the more architecturally consistent choice.
class MockImage {
  src = '';
  naturalWidth = MOCKED_BBOX.width;
  naturalHeight = MOCKED_BBOX.height;
  async decode(): Promise<void> {
    // Deliberately not a real decode: no fetch, no network, resolves as soon
    // as the microtask queue lets it. See class comment above.
  }
}

/**
 * Visual text rows for an element.
 *
 * With `htmlLabels: false` mermaid renders each `<br/>` as a sibling
 * `<tspan class="text-outer-tspan row">` child of `<text>`, each wrapping an
 * inner tspan. `textContent` concatenates those rows with NO separator, so
 * splitting it on newlines always yields a single line — which pinned every node
 * to one line-height and made width grow with the concatenation instead of the
 * longest row (see issue #7).
 *
 * Direct tspan children are the row boundary. `children` walks only one level,
 * so the inner tspan elements nested inside each row are never double-counted.
 * Falls back to newline splitting when an element has no tspan children.
 */
function textRows(el: Element, text: string): string[] {
  const rows = [...el.children]
    .filter((child) => child.tagName?.toLowerCase() === 'tspan')
    .map((child) => child.textContent ?? '');

  return rows.length > 0 ? rows : text.split('\n');
}

const TRANSLATE_RE = /translate\(\s*(-?[\d.]+)\s*[ ,]\s*(-?[\d.]+)/;
const PATH_NUM_RE = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;
const PATH_CMD_RE = /([ACHLMQSTVZachlmqstvz])([^ACHLMQSTVZachlmqstvz]*)/g;

/**
 * Emit every point a path `d` touches.
 *
 * Reading `d` as blind number pairs is wrong: `H`/`V` take a single coordinate
 * and `A` takes five non-positional parameters before its endpoint, so a d3 axis
 * like `M0.5,6V0.5H922.5V6` would report a phantom y of 922. Control points are
 * emitted too — a curve stays inside its control hull, so the resulting box is
 * correct, just occasionally generous.
 */
function eachPathPoint(d: string, emit: (x: number, y: number) => void): void {
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  const commands = new RegExp(PATH_CMD_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = commands.exec(d)) !== null) {
    const cmd = match[1];
    const abs = cmd.toUpperCase();
    const relative = cmd !== abs;
    const numbers = (match[2].match(PATH_NUM_RE) ?? []).map(Number);

    if (abs === 'Z') {
      cx = startX;
      cy = startY;
      emit(cx, cy);
      continue;
    }

    // Numbers consumed per repetition of the command.
    const stride =
      abs === 'H' || abs === 'V'
        ? 1
        : abs === 'A'
          ? 7
          : abs === 'C'
            ? 6
            : abs === 'S' || abs === 'Q'
              ? 4
              : 2;

    for (let i = 0; i + stride <= numbers.length; i += stride) {
      if (abs === 'H') {
        cx = relative ? cx + numbers[i] : numbers[i];
      } else if (abs === 'V') {
        cy = relative ? cy + numbers[i] : numbers[i];
      } else if (abs === 'A') {
        // rx ry x-axis-rotation large-arc-flag sweep-flag x y
        cx = relative ? cx + numbers[i + 5] : numbers[i + 5];
        cy = relative ? cy + numbers[i + 6] : numbers[i + 6];
      } else {
        // Relative control points are offset from the segment start, not from
        // each other, so baseX/baseY stay put until the endpoint is consumed.
        const baseX = cx;
        const baseY = cy;
        for (let p = 0; p + 1 < stride; p += 2) {
          emit(
            relative ? baseX + numbers[i + p] : numbers[i + p],
            relative ? baseY + numbers[i + p + 1] : numbers[i + p + 1]
          );
        }
        cx = relative ? baseX + numbers[i + stride - 2] : numbers[i + stride - 2];
        cy = relative ? baseY + numbers[i + stride - 1] : numbers[i + stride - 1];
        if (abs === 'M' && i === 0) {
          startX = cx;
          startY = cy;
        }
      }
      emit(cx, cy);
    }
  }
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  found: boolean;
}

function attr(el: Element, name: string): number {
  return parseFloat(el.getAttribute(name) ?? '');
}

/**
 * Union of the real geometry laid out beneath an element.
 *
 * After dagre runs, flowchart nodes carry explicit boxes —
 * `<g class="node" transform="translate(266,58)"><rect x="-126" y="-99" width="252" height="198"/>`
 * — and edges carry coordinates in their path `d`. The previous estimate summed
 * descendant *text* heights and ignored inter-node spacing and edge routing
 * entirely, so the root viewBox bounded neither the height nor the width of its
 * own content — the long-standing undersize issue.
 *
 * Returns `found: false` when there is no real geometry to union — notably for
 * mermaid's label groups, whose `<rect class="background">` carries no width or
 * height. Those still need the text estimate, because they are measured *during*
 * layout, before any box exists.
 */
function geometricBounds(root: Element): Bounds {
  const b: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    found: false,
  };

  const add = (x1: number, y1: number, x2: number, y2: number): void => {
    b.minX = Math.min(b.minX, x1, x2);
    b.minY = Math.min(b.minY, y1, y2);
    b.maxX = Math.max(b.maxX, x1, x2);
    b.maxY = Math.max(b.maxY, y1, y2);
    b.found = true;
  };

  const walk = (el: Element, dx: number, dy: number): void => {
    const tag = el.tagName?.toLowerCase() ?? '';
    // <defs>/<marker> hold off-canvas template geometry — never part of the drawing.
    if (tag === 'defs' || tag === 'marker') {
      return;
    }

    const m = TRANSLATE_RE.exec(el.getAttribute?.('transform') ?? '');
    const ox = dx + (m ? parseFloat(m[1]) : 0);
    const oy = dy + (m ? parseFloat(m[2]) : 0);

    if (tag === 'rect') {
      const w = attr(el, 'width');
      const h = attr(el, 'height');
      if (w > 0 && h > 0) {
        const x = attr(el, 'x') || 0;
        const y = attr(el, 'y') || 0;
        add(ox + x, oy + y, ox + x + w, oy + y + h);
      }
    } else if (tag === 'circle' || tag === 'ellipse') {
      const r = attr(el, 'r');
      const rx = Number.isFinite(r) ? r : attr(el, 'rx');
      const ry = Number.isFinite(r) ? r : attr(el, 'ry');
      if (rx > 0 && ry > 0) {
        const cx = attr(el, 'cx') || 0;
        const cy = attr(el, 'cy') || 0;
        add(ox + cx - rx, oy + cy - ry, ox + cx + rx, oy + cy + ry);
      }
    } else if (tag === 'path') {
      eachPathPoint(el.getAttribute('d') ?? '', (x, y) => add(ox + x, oy + y, ox + x, oy + y));
    } else if (tag === 'polygon' || tag === 'polyline') {
      const numbers = (el.getAttribute('points') ?? '').match(PATH_NUM_RE);
      if (numbers) {
        for (let i = 0; i + 1 < numbers.length; i += 2) {
          const x = ox + parseFloat(numbers[i]);
          const y = oy + parseFloat(numbers[i + 1]);
          add(x, y, x, y);
        }
      }
    }

    for (const child of [...el.children]) {
      walk(child, ox, oy);
    }
  };

  for (const child of [...root.children]) {
    walk(child, 0, 0);
  }
  return b;
}

// RenderQueue times out a render that never settles and moves on to the next
// queued one (2026-08-05 wedge fix) rather than waiting forever, so a call
// abandoned by that timeout can still be running here in the background,
// sharing these same process-global window/document with whatever call is
// now actually active. If the abandoned call's promise eventually settles,
// its `finally` must not blindly restore globals out from under the call
// that superseded it: `generation` tags each call, and only the call that
// is still the most-recently-started one is allowed to write globals back.
let activeGeneration = 0;

export async function withEnvironment<T>(fn: () => Promise<T>): Promise<T> {
  const generation = ++activeGeneration;
  const oldWindow = global.window;
  const oldDocument = global.document;
  const oldMutationObserver = (global as Record<string, unknown>).MutationObserver;
  const oldCSSStyleSheet = (global as Record<string, unknown>).CSSStyleSheet;
  const oldScreen = (global as Record<string, unknown>).screen;
  const oldImage = (global as Record<string, unknown>).Image;

  try {
    const dom = new JSDOM(BASE_HTML, {
      resources: 'usable',
      beforeParse(window) {
        setProperty(window.Element.prototype, 'getBBox', function (this: Element) {
          // Check if this is a leaf text element or a container group
          const tagName = this.tagName?.toLowerCase() ?? '';

          // Real laid-out geometry wins over any text heuristic, and is checked
          // before the empty-text guard below: a group of positioned nodes and
          // edges is measurable even when it carries no text at all.
          if (tagName === 'g' || tagName === 'svg') {
            const geo = geometricBounds(this);
            if (geo.found) {
              return {
                x: geo.minX,
                y: geo.minY,
                width: geo.maxX - geo.minX,
                height: geo.maxY - geo.minY,
              };
            }
          }

          // For elements with text content, estimate dimensions from text
          const text = this.textContent ?? '';
          if (!text.trim()) {
            // Empty text and empty containers occupy no space, and zeros are what
            // a browser reports for them. Handing back the fallback box instead
            // made dagre reserve a full label's worth of rank space for every
            // unlabelled edge — mermaid measures an edge label through its <text>,
            // so an empty one produced a 100x100 label box where a real label
            // measured 28x28, and an EMPTY edge label pushed nodes further apart
            // than a real one did. Other leaf shapes keep the fallback: a bare
            // <rect> has no meaningful box either way (see issue #9).
            return tagName === 'g' || tagName === 'svg' || tagName === 'text' || tagName === 'tspan'
              ? { x: 0, y: 0, width: 0, height: 0 }
              : { ...MOCKED_BBOX };
          }

          if (tagName === 'text' || tagName === 'tspan') {
            // Leaf text element — size proportional to content
            const lines = textRows(this, text);
            const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
            return {
              x: 0,
              y: 0,
              width: maxLen * CHAR_WIDTH,
              height: lines.length * LINE_HEIGHT,
            };
          }

          if (tagName === 'g' || tagName === 'svg') {
            // No real geometry yet (label group, measured during layout) —
            // estimate from all descendant <text> elements.
            // Only select 'text' (not 'tspan') because text.textContent already
            // aggregates nested tspan content, avoiding double-counting.
            const textEls = this.querySelectorAll('text');
            if (textEls.length === 0) {
              return { ...MOCKED_BBOX };
            }

            // Accumulate text content dimensions
            let totalWidth = 0;
            let totalHeight = 0;

            textEls.forEach((el) => {
              const t = el.textContent ?? '';
              const lines = textRows(el, t);
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
        setProperty(window.Element.prototype, 'getComputedTextLength', function (this: Element) {
          const text = this.textContent ?? '';
          return text.length * 8;
        });
        setProperty(window.Element.prototype, 'getBoundingClientRect', function (this: Element) {
          // textContent aggregates all descendant text. Correct for leaf/label
          // elements (mermaid's primary call sites in util.ts and createText.ts),
          // but may overestimate for containers with many children.
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
      },
    });

    setProperty(global, 'window', dom.window);
    setProperty(global, 'document', dom.window.document);
    setProperty(global, 'MutationObserver', undefined);
    // mermaid's createCssStyles (mermaidAPI.ts) does `new CSSStyleSheet()`
    // unconditionally, assuming a browser global — jsdom implements the
    // constructor (insertRule/cssRules work; replaceSync doesn't, which
    // mermaid itself already guards with a typeof check) but window
    // properties aren't bare Node globals unless exposed like this.
    setProperty(global, 'CSSStyleSheet', dom.window.CSSStyleSheet);
    setProperty(global, 'screen', MOCK_SCREEN);
    setProperty(global, 'Image', MockImage);

    return await fn();
  } finally {
    // A call that lost the timeout race and is only settling now must not
    // stomp on whatever a later, still-active call has since installed.
    if (generation === activeGeneration) {
      setProperty(global, 'window', oldWindow);
      setProperty(global, 'document', oldDocument);
      setProperty(global, 'MutationObserver', oldMutationObserver);
      setProperty(global, 'screen', oldScreen);
      setProperty(global, 'Image', oldImage);
      setProperty(global, 'CSSStyleSheet', oldCSSStyleSheet);
    }
  }
}
