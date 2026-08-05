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

  it('documents the syntax-only contract: reports valid for a label that fails at render time', async () => {
    // /parse validates grammar via mermaid.parse(), which never lays out labels.
    // This diagram is grammatically valid but 422s with RENDER_ERROR on /render
    // (see render.test.ts) because word-wrapping a markdown list injects a
    // newline that splitLineToFitWidth rejects. Documented in REFERENCE.md as a
    // known limitation of the syntax-only contract, not something /parse can catch.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: {
        diagram: 'flowchart TD\n  A["Base<br/>+ extra line<br/>+ another"] --> B["x"]',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).valid).toBe(true);
  });

  it('omits ast fields when ast is not requested', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'pie\n"A": 40\n"B": 60' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ast).toBeUndefined();
    expect(body.astSupported).toBeUndefined();
  });

  it('returns a JSON-safe AST for a Langium-backed diagram type when ast: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'pie\n"A": 40\n"B": 60', ast: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.astSupported).toBe(true);
    expect(body.diagramType).toBe('pie');
    expect(body.ast).toBeDefined();
    expect(body.ast.$type).toBe('Pie');
    expect(body.ast.sections).toHaveLength(2);
    expect(JSON.stringify(body.ast)).not.toContain('$cstNode');
    expect(JSON.stringify(body.ast)).not.toContain('$container');
  });

  it('reports astSupported: false and omits ast for Jison-backed diagram types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'graph TD; A-->B', ast: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.astSupported).toBe(false);
    expect(body.ast).toBeUndefined();
  });

  it('still returns 422 with error details for invalid syntax when ast: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/parse',
      payload: { diagram: 'graph TD;\n  A-->', ast: true },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('PARSE_ERROR');
  });

  describe('caching', () => {
    it('marks the first request MISS and an identical repeat HIT', async () => {
      const payload = { diagram: 'graph TD; A-->B; B-->C' };
      const first = await app.inject({ method: 'POST', url: '/api/v1/parse', payload });
      const second = await app.inject({ method: 'POST', url: '/api/v1/parse', payload });

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.payload).toBe(first.payload);
    });

    it('does not confuse two different configs for the same diagram (no false HIT)', async () => {
      // Unique diagram text so this test's cache entries can't be pre-warmed
      // by an earlier test in this file sharing the same app/cache instance.
      const base = { diagram: 'graph TD; CacheKeyTest1-->CacheKeyTest2' };
      const light = await app.inject({
        method: 'POST',
        url: '/api/v1/parse',
        payload: { ...base, config: { theme: 'default' } },
      });
      const dark = await app.inject({
        method: 'POST',
        url: '/api/v1/parse',
        payload: { ...base, config: { theme: 'dark' } },
      });

      expect(light.headers['x-cache']).toBe('MISS');
      expect(dark.headers['x-cache']).toBe('MISS');
    });

    it('does not false-HIT between a plain request and an ast:true request for the same diagram', async () => {
      const diagram = 'pie\n"CacheAst1": 40\n"CacheAst2": 60';
      const plain = await app.inject({
        method: 'POST',
        url: '/api/v1/parse',
        payload: { diagram },
      });
      const withAst = await app.inject({
        method: 'POST',
        url: '/api/v1/parse',
        payload: { diagram, ast: true },
      });

      expect(plain.headers['x-cache']).toBe('MISS');
      expect(withAst.headers['x-cache']).toBe('MISS'); // must not HIT the plain (no-ast) entry
      expect(JSON.parse(plain.payload).ast).toBeUndefined();
      expect(JSON.parse(withAst.payload).ast).toBeDefined();
    });
  });
});
