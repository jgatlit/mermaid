import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { healthRoutes } from '../../src/routes/health.js';
import type { MermaidBridge } from '../../src/renderer/mermaid-bridge.js';
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

    it('reports the real installed mermaid version, not a hardcoded literal', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const body = JSON.parse(res.payload);
      const actualVersion = createRequire(import.meta.url)('mermaid/package.json').version;
      expect(body.mermaidVersion).toBe(actualVersion);
    });

    it('reports png capability matching config.png.enabled', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const body = JSON.parse(res.payload);
      expect(body.capabilities.png).toBe(loadConfig().png.enabled);
    });
  });

  describe('GET /api/v1/health when rendering is broken', () => {
    it('returns 503 with status degraded instead of a false-positive ok', async () => {
      const brokenApp = Fastify();
      const brokenBridge = {
        render: () => Promise.reject(new Error('Cannot find module fake-chunk.mjs')),
      } as unknown as MermaidBridge;
      healthRoutes(brokenApp, brokenBridge, loadConfig());

      const res = await brokenApp.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('degraded');
      expect(body.error).toContain('fake-chunk.mjs');

      await brokenApp.close();
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

describe('Health endpoints with PNG disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig();
    app = await buildApp({ ...config, png: { ...config.png, enabled: false } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports capabilities.png as false', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const body = JSON.parse(res.payload);
    expect(body.capabilities.png).toBe(false);
  });
});
