import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Health endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('mermaidVersion');
      expect(body).toHaveProperty('uptime');
      expect(body.capabilities).toHaveProperty('svg', true);
    });
  });

  describe('GET /api/v1/diagram-types', () => {
    it('returns list of supported diagram types', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/diagram-types' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.diagramTypes).toBeInstanceOf(Array);
      expect(body.diagramTypes.length).toBeGreaterThan(10);
      expect(body.themes).toContain('default');
      expect(body.themes).toContain('dark');
    });
  });
});
