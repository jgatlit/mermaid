import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/extract', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('extracts mermaid blocks from markdown', async () => {
    const markdown = await readFile(join(import.meta.dirname, '../fixtures/sample.md'), 'utf-8');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { markdown },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.count).toBe(2);
    expect(body.diagrams[0].diagram).toContain('graph TD');
    expect(body.diagrams[1].diagram).toContain('sequenceDiagram');
  });

  it('validates diagrams when validate=true', async () => {
    const markdown = await readFile(join(import.meta.dirname, '../fixtures/sample.md'), 'utf-8');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { markdown, validate: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.diagrams[0]).toHaveProperty('diagramType');
    expect(body.diagrams[0]).toHaveProperty('valid', true);
  });

  it('returns empty for markdown without mermaid blocks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { markdown: '# Just text\n\nNo diagrams here.' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).count).toBe(0);
  });
});
