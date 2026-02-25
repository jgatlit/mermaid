import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { normalizeError } from '../errors/normalize.js';

interface BatchItem {
  id?: string;
  diagram: string;
  operation?: 'parse' | 'detect' | 'render';
  config?: Record<string, unknown>;
}

interface BatchBody {
  items: BatchItem[];
  defaults?: {
    operation?: 'parse' | 'detect' | 'render';
    config?: Record<string, unknown>;
  };
}

export function batchRoute(app: FastifyInstance, bridge: MermaidBridge) {
  app.post(
    '/api/v1/batch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['diagram'],
                properties: {
                  id: { type: 'string' },
                  diagram: { type: 'string', maxLength: 50000 },
                  operation: { type: 'string', enum: ['parse', 'detect', 'render'] },
                  config: { type: 'object', additionalProperties: true },
                },
              },
            },
            defaults: {
              type: 'object',
              properties: {
                operation: { type: 'string', enum: ['parse', 'detect', 'render'] },
                config: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { items, defaults } = request.body as BatchBody;
      const results: Record<string, unknown>[] = [];
      let succeeded = 0;
      let failed = 0;

      for (const item of items) {
        const op = item.operation ?? defaults?.operation ?? 'render';
        const config = { ...defaults?.config, ...item.config };
        const entry: Record<string, unknown> = { id: item.id };

        try {
          if (op === 'detect') {
            const diagramType = await bridge.detect(item.diagram);
            entry.success = true;
            entry.diagramType = diagramType;
          } else if (op === 'parse') {
            const result = await bridge.parse(item.diagram, config);
            entry.success = true;
            entry.diagramType = result.diagramType;
            entry.valid = true;
          } else {
            const result = await bridge.render(item.diagram, config);
            entry.success = true;
            entry.svg = result.svg;
            entry.diagramType = result.diagramType;
          }
          succeeded++;
        } catch (err) {
          entry.success = false;
          entry.error = normalizeError(err);
          failed++;
        }

        results.push(entry);
      }

      return {
        results,
        summary: { total: items.length, succeeded, failed },
      };
    }
  );
}
