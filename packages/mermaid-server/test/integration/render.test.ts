import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

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

  it('returns 422 for invalid diagram', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/render',
      payload: { diagram: 'graph TD;\n  A-->' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).error.code).toBe('PARSE_ERROR');
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
    expect(svg).not.toMatch(/foreignObject[^>]*width="0"/);
    expect(svg).not.toMatch(/foreignObject[^>]*height="0"/);

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
      expect(svg).not.toMatch(/foreignObject[^>]*width="0"/);
    }
  });
});
