import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';

const THEMES = ['default', 'dark', 'forest', 'neutral', 'base'];

export function healthRoutes(app: FastifyInstance, bridge: MermaidBridge) {
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
        },
      },
    },
    () => {
      return {
        status: 'ok',
        version: '0.1.0',
        mermaidVersion: '11.12.2',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        capabilities: {
          svg: true,
          png: false,
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
