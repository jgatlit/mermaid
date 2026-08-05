import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { runOperation } from '../renderer/operations.js';
import { svgToPng } from '../renderer/png.js';
import type { ServerConfig } from '../config.js';
import { normalizeError } from '../errors/normalize.js';

interface BatchItem {
  id?: string;
  diagram: string;
  operation?: 'parse' | 'detect' | 'render';
  config?: Record<string, unknown>;
  outputFormat?: 'svg' | 'png';
}

interface BatchBody {
  items: BatchItem[];
  defaults?: {
    operation?: 'parse' | 'detect' | 'render';
    config?: Record<string, unknown>;
    outputFormat?: 'svg' | 'png';
  };
}

export function batchRoute(
  app: FastifyInstance,
  bridge: MermaidBridge,
  serverConfig: ServerConfig
) {
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
                  outputFormat: { type: 'string', enum: ['svg', 'png'] },
                },
              },
            },
            defaults: {
              type: 'object',
              properties: {
                operation: { type: 'string', enum: ['parse', 'detect', 'render'] },
                config: { type: 'object', additionalProperties: true },
                outputFormat: { type: 'string', enum: ['svg', 'png'] },
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
        const outputFormat = item.outputFormat ?? defaults?.outputFormat ?? 'svg';
        const config = { ...defaults?.config, ...item.config };
        const entry: Record<string, unknown> = { id: item.id };

        if (outputFormat === 'png' && !serverConfig.png.enabled) {
          entry.success = false;
          entry.error = {
            code: 'PNG_DISABLED',
            message: 'PNG output is disabled on this server (PNG_ENABLED=false)',
            statusCode: 400,
          };
          failed++;
          results.push(entry);
          continue;
        }

        try {
          const result = await runOperation(bridge, op, item.diagram, config);
          entry.success = true;
          entry.diagramType = result.diagramType;
          if (result.svg !== undefined) {
            if (outputFormat === 'png') {
              entry.png = svgToPng(result.svg).toString('base64');
            } else {
              entry.svg = result.svg;
            }
          }
          if (op === 'parse') {
            entry.valid = true;
          }
          if (result.warnings?.length) {
            entry.warnings = result.warnings;
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
