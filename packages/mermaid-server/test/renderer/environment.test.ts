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
