import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { FastifyInstance } from 'fastify';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('POST /api/v1/batch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('processes multiple diagrams', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [
          { id: 'flow', diagram: 'graph TD; A-->B' },
          { id: 'seq', diagram: 'sequenceDiagram\n  Alice->>Bob: Hi' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.summary.total).toBe(2);
    expect(body.summary.succeeded).toBe(2);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].svg).toContain('<svg');
  });

  it('handles mixed success and failure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [
          { id: 'good', diagram: 'graph TD; A-->B' },
          { id: 'bad', diagram: 'graph TD;\n  A-->' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.summary.succeeded).toBe(1);
    expect(body.summary.failed).toBe(1);
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toHaveProperty('code');
  });

  it('supports parse-only operation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        defaults: { operation: 'parse' },
        items: [{ diagram: 'graph TD; A-->B' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0]).toHaveProperty('diagramType');
    expect(body.results[0]).not.toHaveProperty('svg');
  });

  it('propagates render warnings per item (parity with /render)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [{ id: 'warns', diagram: 'graph TD; A-->B', config: { htmlLabels: true } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].warnings).toBeDefined();
    expect(body.results[0].warnings.some((w: string) => w.includes('htmlLabels'))).toBe(true);
  });

  it('propagates parse warnings too, not just render', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        defaults: { operation: 'parse' },
        items: [{ diagram: 'graph TD; A-->B', config: { htmlLabels: true } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results[0].warnings).toBeDefined();
  });

  it('supports per-item png output', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [{ id: 'png', diagram: 'graph TD; A-->B', outputFormat: 'png' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0]).not.toHaveProperty('svg');
    const pngBytes = Buffer.from(body.results[0].png, 'base64');
    expect(pngBytes.subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it('mixes svg and png items in one batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [
          { id: 'svg', diagram: 'graph TD; A-->B' },
          { id: 'png', diagram: 'graph TD; A-->B', outputFormat: 'png' },
        ],
      },
    });
    const body = JSON.parse(res.payload);
    expect(body.results[0].svg).toContain('<svg');
    expect(body.results[0]).not.toHaveProperty('png');
    expect(body.results[1]).not.toHaveProperty('svg');
    expect(Buffer.from(body.results[1].png, 'base64').subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it('rejects batch exceeding max items', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      diagram: `graph TD; A${i}-->B${i}`,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: { items },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /api/v1/batch with PNG disabled', () => {
  let disabledApp: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig();
    disabledApp = await buildApp({ ...config, png: { ...config.png, enabled: false } });
  });
  afterAll(async () => {
    await disabledApp.close();
  });

  it('marks a png item failed instead of silently falling back to svg', async () => {
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        items: [{ id: 'png', diagram: 'graph TD; A-->B', outputFormat: 'png' }],
      },
    });
    expect(res.statusCode).toBe(200); // batch endpoint itself is always 200
    const body = JSON.parse(res.payload);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error.code).toBe('PNG_DISABLED');
    expect(body.summary.failed).toBe(1);
  });

  it('still processes svg items in the same batch normally', async () => {
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: { items: [{ diagram: 'graph TD; A-->B' }] },
    });
    const body = JSON.parse(res.payload);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].svg).toContain('<svg');
  });
});
