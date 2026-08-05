import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { FastifyInstance } from 'fastify';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('POST /api/v1/render', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('renders SVG with raw output format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.payload).toContain('<svg');
  });

  it('renders SVG as JSON-wrapped string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B', outputFormat: 'svg-string' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.payload);
    expect(body.svg).toContain('<svg');
    expect(body.diagramType).toMatch(/flowchart/);
  });

  it('applies theme override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'graph TD; A-->B',
        config: { theme: 'dark' },
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).svg).toContain('<svg');
  });

  // Regression: mermaid core's createCssStyles does `new CSSStyleSheet()`
  // unconditionally (mermaidAPI.ts), which threw "CSSStyleSheet is not
  // defined" in production even though the entire test suite passed —
  // vitest's own jsdom test environment happens to expose it globally,
  // masking that withEnvironment()'s hand-rolled JSDOM instance didn't.
  it('renders successfully with themeCSS set (exercises createCssStyles/CSSStyleSheet)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'graph TD; A-->B',
        config: { themeCSS: '.node rect { fill: red; }' },
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).svg).toContain('<svg');
  });

  it('returns 422 for invalid diagram', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD;\n  A-->' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).error.code).toBe('PARSE_ERROR');
  });

  // Was a 500 (then a 422 RENDER_ERROR) before the getBBox fix in 10d78bb7b; the more
  // accurate text measurement means this label no longer needs the forced wrap that
  // used to hit splitLineToFitWidth's embedded-newline guard.
  it('renders a wrapping label with 2+ markdown list items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart TD\n  A["Base<br/>+ extra line<br/>+ another"] --> B["x"]',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('<svg');
  });

  it('normalizes literal \\n to <br/> and reports it via X-Mermaid-Warnings on raw SVG', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'flowchart TD\n  A["One\\nTwo"] --> B' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('\\n');
    expect(res.headers['x-mermaid-warnings']).toBeDefined();
    expect(res.headers['x-mermaid-warnings']).toContain('\\n');
  });

  it('normalizes literal \\n and reports it via a warnings[] field on svg-string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart TD\n  A["One\\nTwo"] --> B',
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.svg).not.toContain('\\n');
    expect(body.warnings).toBeDefined();
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('omits warnings entirely when nothing needed rewriting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B', outputFormat: 'svg-string' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-mermaid-warnings']).toBeUndefined();
    expect(JSON.parse(res.payload).warnings).toBeUndefined();
  });

  it('renders sequence diagram', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'sequenceDiagram\n  Alice->>Bob: Hello', outputFormat: 'svg-string' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).diagramType).toMatch(/sequence/);
  });

  it('renders pie chart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'pie\n  "Dogs" : 386\n  "Cats" : 85', outputFormat: 'svg-string' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('flowchart foreignObjects have non-zero dimensions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart LR\n    A[Hello World] --> B[Goodbye World]',
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);

    // No zero-dimension foreignObjects
    expect(svg).not.toMatch(/foreignObject[^>]*\bwidth="0"/);
    expect(svg).not.toMatch(/foreignObject[^>]*\bheight="0"/);

    // ViewBox should have positive dimensions
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    expect(vbMatch).toBeTruthy();
    const parts = vbMatch[1].split(' ').map(Number);
    const [, , width, height] = parts;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('gantt chart has non-zero viewBox width', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram:
          'gantt\n    title Test\n    dateFormat YYYY-MM-DD\n    section Tasks\n    A :a1, 2024-01-01, 7d',
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);

    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    expect(vbMatch).toBeTruthy();
    const parts = vbMatch[1].split(' ').map(Number);
    const [, , width] = parts;
    expect(width).toBeGreaterThan(0);
  });

  it('user config can override htmlLabels default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram: 'flowchart LR\n    A[Test] --> B[Node]',
        config: { htmlLabels: true },
        outputFormat: 'svg-string',
      },
    });
    expect(res.statusCode).toBe(200);
    const { svg } = JSON.parse(res.payload);
    // If mermaid honors htmlLabels: true, foreignObject should appear
    // (With our patch, it should have non-zero dimensions)
    if (svg.includes('foreignObject')) {
      expect(svg).not.toMatch(/foreignObject[^>]*\bwidth="0"/);
    }
  });

  it('flowchart viewBox scales with diagram complexity', async () => {
    // Simple 2-node diagram
    const simple = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'flowchart LR\n    A[Hi] --> B[Bye]', outputFormat: 'svg-string' },
    });
    expect(simple.statusCode).toBe(200);
    const simpleBody = JSON.parse(simple.payload);
    const simpleVB = simpleBody.svg.match(/viewBox="([^"]+)"/)[1];
    const [, , simpleWidth, simpleHeight] = simpleVB.split(' ').map(Number);

    // Complex 6-node diagram with longer labels
    const complex = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: {
        diagram:
          'flowchart LR\n    A[Node One with long label] --> B[Node Two]\n    B --> C[Node Three]\n    D[Node Four] --> E[Node Five]\n    E --> F[Node Six with another long label]',
        outputFormat: 'svg-string',
      },
    });
    expect(complex.statusCode).toBe(200);
    const complexBody = JSON.parse(complex.payload);
    const complexVB = complexBody.svg.match(/viewBox="([^"]+)"/)[1];
    const [, , complexWidth, complexHeight] = complexVB.split(' ').map(Number);

    // Complex diagram should have larger viewBox than simple
    expect(complexWidth).toBeGreaterThan(simpleWidth);
    expect(complexHeight).toBeGreaterThan(simpleHeight);

    // Sanity check: neither should be the constant 116×116
    expect(simpleWidth).not.toBe(116);
    expect(complexWidth).not.toBe(116);
  });

  it('renders PNG with png output format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B', outputFormat: 'png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(res.rawPayload.length).toBeGreaterThan(8);
  });

  it('rendered PNG bytes decode to non-zero dimensions matching the SVG viewBox', async () => {
    const svgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'flowchart LR\n    A[Hello] --> B[World]', outputFormat: 'svg-string' },
    });
    const { svg } = JSON.parse(svgRes.payload);
    const [, , svgWidth, svgHeight] = svg
      .match(/viewBox="([^"]+)"/)[1]
      .split(' ')
      .map(Number);

    const pngRes = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'flowchart LR\n    A[Hello] --> B[World]', outputFormat: 'png' },
    });
    expect(pngRes.statusCode).toBe(200);
    // IHDR chunk: width/height are the 4-byte big-endian ints at offset 16 and 20
    const pngWidth = pngRes.rawPayload.readUInt32BE(16);
    const pngHeight = pngRes.rawPayload.readUInt32BE(20);
    expect(pngWidth).toBe(Math.round(svgWidth));
    expect(pngHeight).toBe(Math.round(svgHeight));
  });

  describe('caching', () => {
    it('marks the first request MISS and an identical repeat HIT', async () => {
      const payload = {
        diagram: 'flowchart LR\n    A[Cache] --> B[Me]',
        outputFormat: 'svg-string' as const,
      };
      const first = await app.inject({ method: 'POST', url: '/api/v1/render', payload });
      const second = await app.inject({ method: 'POST', url: '/api/v1/render', payload });

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.payload).toBe(first.payload);
    });

    it('does not confuse two different configs for the same diagram (no false HIT)', async () => {
      const base = {
        diagram: 'flowchart LR\n    A[X] --> B[Y]',
        outputFormat: 'svg-string' as const,
      };
      const light = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: { ...base, config: { theme: 'default' } },
      });
      const dark = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: { ...base, config: { theme: 'dark' } },
      });

      expect(light.headers['x-cache']).toBe('MISS');
      expect(dark.headers['x-cache']).toBe('MISS'); // different config must not HIT the light-theme entry
      expect(JSON.parse(light.payload).svg).not.toBe(JSON.parse(dark.payload).svg);
    });

    it('is insensitive to config key order (same config, different key order, still HITs)', async () => {
      const diagram = 'flowchart LR\n    A[Order] --> B[Insensitive]';
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: {
          diagram,
          config: { theme: 'forest', flowchart: { curve: 'basis' } },
          outputFormat: 'svg-string',
        },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: {
          diagram,
          config: { flowchart: { curve: 'basis' }, theme: 'forest' },
          outputFormat: 'svg-string',
        },
      });

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
    });

    it('does not cache gantt output, since the default today-marker depends on wall-clock time', async () => {
      const payload = {
        diagram:
          'gantt\n    title Cache Test\n    dateFormat YYYY-MM-DD\n    section Tasks\n    A :a1, 2026-01-01, 7d',
        outputFormat: 'svg-string' as const,
      };
      const first = await app.inject({ method: 'POST', url: '/api/v1/render', payload });
      const second = await app.inject({ method: 'POST', url: '/api/v1/render', payload });

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('MISS');
    });

    it('caches the raw svg output format too, keyed separately from svg-string', async () => {
      const diagram = 'flowchart LR\n    A[Raw] --> B[Format]';
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: { diagram }, // default outputFormat: 'svg'
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: { diagram },
      });

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.payload).toBe(first.payload);
    });
  });
});

describe('POST /api/v1/render with PNG disabled', () => {
  let disabledApp: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig();
    disabledApp = await buildApp({ ...config, png: { ...config.png, enabled: false } });
  });
  afterAll(async () => {
    await disabledApp.close();
  });

  it('returns a 4xx error instead of falling back to SVG', async () => {
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B', outputFormat: 'png' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('PNG_DISABLED');
  });

  it('still renders SVG normally', async () => {
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD; A-->B' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });
});
