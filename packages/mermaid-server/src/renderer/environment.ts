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

export async function withEnvironment<T>(fn: () => Promise<T>): Promise<T> {
  const oldWindow = global.window;
  const oldDocument = global.document;
  const oldMutationObserver = (global as Record<string, unknown>).MutationObserver;

  try {
    const dom = new JSDOM(BASE_HTML, {
      resources: 'usable',
      beforeParse(window) {
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
            // Group or root — estimate from all descendant <text> elements.
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

    return await fn();
  } finally {
    setProperty(global, 'window', oldWindow);
    setProperty(global, 'document', oldDocument);
    setProperty(global, 'MutationObserver', oldMutationObserver);
  }
}
