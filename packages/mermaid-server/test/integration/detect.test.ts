import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/detect', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('detects flowchart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/detect',
      payload: { diagram: 'graph TD; A-->B' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).diagramType).toMatch(/flowchart/);
  });

  it('detects sequence diagram', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/detect',
      payload: { diagram: 'sequenceDiagram\n  Alice->>Bob: Hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).diagramType).toMatch(/sequence/);
  });

  it('returns 422 for unrecognized text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/detect',
      payload: { diagram: 'this is not a diagram' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).error.code).toBe('UNKNOWN_DIAGRAM_TYPE');
  });

  it('returns 400 when diagram is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/detect',
      payload: {},
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
