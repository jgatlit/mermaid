import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/parse', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('parses valid flowchart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'graph TD; A-->B' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.valid).toBe(true);
    expect(body.diagramType).toMatch(/flowchart/);
  });

  it('returns 422 with error details for invalid syntax', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'graph TD;\n  A-->' },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('PARSE_ERROR');
  });

  it('accepts config overrides', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'graph TD; A-->B', config: { theme: 'dark' } },
    });
    expect(res.statusCode).toBe(200);
  });
});
