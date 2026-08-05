import { describe, it, expect } from 'vitest';
import { withEnvironment } from '../../src/renderer/environment.js';

describe('withEnvironment', () => {
  it('provides global window and document inside callback', async () => {
    let hadWindow = false;
    let hadDocument = false;

    await withEnvironment(() => {
      hadWindow = global.window !== undefined && global.window !== null;
      hadDocument = global.document !== undefined && global.document !== null;
    });

    expect(hadWindow).toBe(true);
    expect(hadDocument).toBe(true);
  });

  it('restores globals after callback completes', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    await withEnvironment(() => {
      // inside: globals are JSDOM
    });

    expect(global.window).toBe(originalWindow);
    expect(global.document).toBe(originalDocument);
  });

  it('restores globals even if callback throws', async () => {
    const originalWindow = global.window;

    await expect(
      withEnvironment(() => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');

    expect(global.window).toBe(originalWindow);
  });

  it('exposes CSSStyleSheet as a bare global (mermaid core calls `new CSSStyleSheet()` unconditionally)', async () => {
    let ctorType: string | undefined;
    let instanceWorks = false;

    await withEnvironment(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the raw global exactly as mermaid core does
      const CSSStyleSheetCtor = (global as any).CSSStyleSheet;
      ctorType = typeof CSSStyleSheetCtor;
      const sheet = new CSSStyleSheetCtor();
      sheet.insertRule(':root { --x: 1 }', 0);
      instanceWorks = true;
    });

    expect(ctorType).toBe('function');
    expect(instanceWorks).toBe(true);
  });

  it('restores CSSStyleSheet after callback completes', async () => {
    const original = (global as Record<string, unknown>).CSSStyleSheet;

    await withEnvironment(() => {
      // inside: CSSStyleSheet is JSDOM's
    });

    expect((global as Record<string, unknown>).CSSStyleSheet).toBe(original);
  });

  it('patches getBBox on SVG elements', async () => {
    await withEnvironment(() => {
      const rect = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bbox = (rect as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox).toHaveProperty('width');
      expect(bbox).toHaveProperty('height');
      expect(bbox.width).toBe(100); // Fallback for non-text elements
      expect(bbox.height).toBe(100);
    });
  });

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

  it('getBBox handles nested tspan structure without double-counting', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');

      // Mirrors mermaid's actual output: <text><tspan><tspan>label</tspan></tspan></text>
      for (const label of ['Node A', 'Node B']) {
        const text = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const outerTspan = global.document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        const innerTspan = global.document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        innerTspan.textContent = label;
        outerTspan.appendChild(innerTspan);
        text.appendChild(outerTspan);
        g.appendChild(text);
      }

      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      // 2 text elements × (24 line height + 16 padding) = 80, not double-counted
      expect(bbox.height).toBe(80);
    });
  });

  // --- Multi-line label measurement (issue #7 regression) -------------
  // With htmlLabels:false, mermaid renders each <br/> row as a sibling
  // tspan.text-outer-tspan.row wrapping a tspan.text-inner-tspan. textContent
  // concatenates those rows with NO separator, so splitting on '\n' sees one
  // line: node height came back constant and width grew with the concatenation.
  // Verified live against chart.chem.dev 2026-08-04 at 1/3/5 rows.

  // Build mermaid's real multi-row label:
  //   <text><tspan class="...row"><tspan>row</tspan></tspan>…</text>
  function makeRowText(rows: string[]): Element {
    const text = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
    for (const row of rows) {
      const outer = global.document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      outer.setAttribute('class', 'text-outer-tspan row');
      const inner = global.document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      inner.setAttribute('class', 'text-inner-tspan');
      inner.textContent = row;
      outer.appendChild(inner);
      text.appendChild(outer);
    }
    return text;
  }

  it('getBBox counts tspan rows as separate lines on <text>', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = makeRowText(['One', 'Two', 'Three']);
      svg.appendChild(text);
      global.document.body.appendChild(svg);
      const bbox = (text as Record<string, unknown>).getBBox() as { height: number };
      expect(bbox.height).toBe(72); // 3 rows × 24, not 1 × 24
    });
  });

  it('getBBox sizes <text> width to the longest row, not the concatenation', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = makeRowText(['One', 'Two', 'Three']);
      svg.appendChild(text);
      global.document.body.appendChild(svg);
      const bbox = (text as Record<string, unknown>).getBBox() as { width: number };
      // longest row "Three" = 5 chars × 8 = 40, NOT "OneTwoThree" = 11 × 8 = 88
      expect(bbox.width).toBe(40);
    });
  });

  it('getBBox scales <text> height with row count', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      global.document.body.appendChild(svg);
      const heights = [1, 2, 3, 5].map((n) => {
        const text = makeRowText(Array.from({ length: n }, (_, i) => `row${i}`));
        svg.appendChild(text);
        return ((text as Record<string, unknown>).getBBox() as { height: number }).height;
      });
      expect(heights).toEqual([24, 48, 72, 120]);
    });
  });

  it('getBBox aggregates multi-row labels in a <g> group', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.appendChild(makeRowText(['One', 'Two', 'Three']));
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.height).toBe(88); // 3 rows × 24 + 16 padding
      expect(bbox.width).toBe(72); // longest row 5 × 8 + 32 padding
    });
  });

  it('getBBox leaves single-row labels unchanged', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = makeRowText(['Hello World']);
      svg.appendChild(text);
      global.document.body.appendChild(svg);
      const bbox = (text as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(88); // 11 chars × 8
      expect(bbox.height).toBe(24); // 1 row × 24
    });
  });

  // An unlabelled edge still emits an empty <g class="edgeLabel">. Returning the
  // 100x100 fallback for it made dagre reserve a full label's worth of rank space
  // for a label that does not exist — so an EMPTY edge label pushed nodes further
  // apart (gap 250) than a real one did (gap 178). A browser returns zeros here.

  it('getBBox returns an empty box for a container with no geometry and no text', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'edgeLabel');
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(0);
      expect(bbox.height).toBe(0);
    });
  });

  it('getBBox returns an empty box for a text element with no content', async () => {
    await withEnvironment(() => {
      // mermaid measures an edge label through its <text>, not the wrapping <g>.
      // An unlabelled edge emits <text><tspan/></text> with no content; returning
      // the fallback box for it produced a 100x100 label (transform
      // "translate(-50, -50)") where a real label measured 28x28.
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = global.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const tspan = global.document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      text.appendChild(tspan);
      svg.appendChild(text);
      global.document.body.appendChild(svg);
      const bbox = (text as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(0);
      expect(bbox.height).toBe(0);
    });
  });

  it('getBBox keeps the 100x100 fallback for non-container leaf elements', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const path = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
      global.document.body.appendChild(svg);
      const bbox = (path as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(100);
      expect(bbox.height).toBe(100);
    });
  });

  // Previously asserted 100x100 here. That encoded the defect in issue #9: an
  // empty group is not 100x100 in any browser, and treating it as such reserved
  // rank space for labels that do not exist.
  it('getBBox returns an empty box for a group with no children', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(0);
      expect(bbox.height).toBe(0);
    });
  });

  // --- Geometric bounds for laid-out groups (the undersize issue) -------------
  // After dagre lays out a flowchart, nodes carry explicit geometry:
  //   <g class="node" transform="translate(266,58)"><rect x="-126" y="-99" width="252" height="198"/>
  // Summing text heights ignores that entirely, so the root viewBox bounded
  // neither the width nor the height of its own content. When real geometry is
  // present, getBBox must union it. Label groups (whose <rect> carries no
  // width/height) must still fall back to text estimation.

  // <g transform="translate(tx,ty)"><rect x y width height/></g>
  function makeNode(tx: number, ty: number, w: number, h: number): Element {
    const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'node');
    g.setAttribute('transform', `translate(${tx}, ${ty})`);
    const rect = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(-w / 2));
    rect.setAttribute('y', String(-h / 2));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    g.appendChild(rect);
    return g;
  }

  it('getBBox unions laid-out node geometry instead of summing text', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.appendChild(makeNode(0, 0, 100, 50)); // spans -50..50 , -25..25
      g.appendChild(makeNode(300, 400, 100, 50)); // spans 250..350 , 375..425
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(400); // -50 .. 350
      expect(bbox.height).toBe(450); // -25 .. 425
    });
  });

  it('getBBox includes edge path coordinates in group bounds', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.appendChild(makeNode(0, 0, 100, 50)); // -50..50 , -25..25
      const path = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0,25L0,120L200,120');
      g.appendChild(path);
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(250); // -50 .. 200
      expect(bbox.height).toBe(145); // -25 .. 120
    });
  });

  it('getBBox still text-estimates label groups that carry no real geometry', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      // mermaid's label group: a <rect> with NO width/height, plus the text
      const bare = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bare.setAttribute('class', 'background');
      g.appendChild(bare);
      g.appendChild(makeRowText(['One', 'Two', 'Three']));
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.height).toBe(88); // text estimation, not geometry
      expect(bbox.width).toBe(72);
    });
  });

  it('getBBox reads H/V path commands as single coordinates', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const path = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // d3 axis shape. Read as blind number pairs this yields a phantom y=400.
      path.setAttribute('d', 'M10,10V400H20');
      g.appendChild(path);
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(10); // x: 10 .. 20
      expect(bbox.height).toBe(390); // y: 10 .. 400
    });
  });

  it('getBBox ignores the non-coordinate parameters of an arc command', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const path = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // A rx=500 ry=500 rot=0 large-arc=0 sweep=1 x=30 y=40 — only 30,40 are points
      path.setAttribute('d', 'M0,0A500,500 0 0 1 30,40');
      g.appendChild(path);
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(30);
      expect(bbox.height).toBe(40);
    });
  });

  it('getBBox ignores marker geometry inside <defs>', async () => {
    await withEnvironment(() => {
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const g = global.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const defs = global.document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.appendChild(makeNode(9000, 9000, 10, 10)); // must not widen bounds
      g.appendChild(defs);
      g.appendChild(makeNode(0, 0, 100, 50));
      svg.appendChild(g);
      global.document.body.appendChild(svg);
      const bbox = (g as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox.width).toBe(100);
      expect(bbox.height).toBe(50);
    });
  });

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
});
