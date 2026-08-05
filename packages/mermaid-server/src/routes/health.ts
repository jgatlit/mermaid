import type { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import type { ServerConfig } from '../config.js';

const THEMES = ['default', 'dark', 'forest', 'neutral', 'base'];

// Was a hardcoded literal that silently drifted from the real installed
// version across two upstream syncs before anyone noticed (11.12.2 quoted as
// fact while the package was actually 11.13.0, then 11.16.0). Resolving it
// from the package itself means it can't drift again.
const mermaidVersion: string = createRequire(import.meta.url)('mermaid/package.json').version;

// This service's whole failure mode is "the process is alive but rendering
// is broken" (confirmed twice in one day: a stale dist chunk graph, then a
// missing jsdom global) — both times /health kept reporting status:"ok"
// throughout the outage, because it never touched the render path. A
// liveness probe that can't detect that failure mode is decoration.
const HEALTH_CHECK_DIAGRAM = 'flowchart TD\nA-->B';

export function healthRoutes(app: FastifyInstance, bridge: MermaidBridge, config: ServerConfig) {
  const startTime = Date.now();

  app.get(
    '/api/v1/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              mermaidVersion: { type: 'string' },
              uptime: { type: 'number' },
              capabilities: {
                type: 'object',
                properties: {
                  svg: { type: 'boolean' },
                  png: { type: 'boolean' },
                  batch: { type: 'boolean' },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              mermaidVersion: { type: 'string' },
              uptime: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const base = {
        version: '0.1.0',
        mermaidVersion,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };

      try {
        await bridge.render(HEALTH_CHECK_DIAGRAM);
      } catch (err) {
        return reply.status(503).send({
          ...base,
          status: 'degraded',
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        ...base,
        status: 'ok',
        capabilities: {
          svg: true,
          png: config.png.enabled,
          batch: true,
        },
      };
    }
  );

  app.get(
    '/api/v1/diagram-types',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              diagramTypes: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'string' } } },
              },
              themes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    async () => {
      const diagramTypes = await bridge.getDiagramTypes();
      return { diagramTypes, themes: THEMES };
    }
  );
}
