import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

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
