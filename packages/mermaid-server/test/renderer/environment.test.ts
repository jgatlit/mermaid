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
      const svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bbox = (svg as Record<string, unknown>).getBBox() as { width: number; height: number };
      expect(bbox).toHaveProperty('width');
      expect(bbox).toHaveProperty('height');
      expect(bbox.width).toBeGreaterThan(0);
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
