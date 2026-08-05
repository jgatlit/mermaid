import type { FastifyInstance } from 'fastify';
import type { MermaidBridge, RenderResult } from '../renderer/mermaid-bridge.js';
import { rewriteRenderId } from '../renderer/mermaid-bridge.js';
import type { BoundedCache } from '../renderer/cache.js';
import { cacheKey } from '../renderer/cache.js';
import type { ServerConfig } from '../config.js';
import { normalizeError } from '../errors/normalize.js';
import { svgToPng } from '../renderer/png.js';
import { diagramInput, errorResponse } from '../schemas/common.js';

interface RenderBody {
  diagram: string;
  config?: Record<string, unknown>;
  outputFormat?: 'svg' | 'svg-string' | 'png';
}

// Gantt diagrams draw a "today" marker line by default (ganttRenderer.js
// drawToday, skipped only when `gantt.todayMarker` is explicitly 'off'),
// positioned from the real wall-clock date rather than anything in the
// diagram text or config. A cached response would freeze that line to
// whichever day it was first rendered — wrong on every later day — so gantt
// output is deliberately excluded from caching even though rendering is a
// pure function of (diagram, config, outputFormat) for every other type.
const NON_CACHEABLE_DIAGRAM_TYPES = new Set(['gantt']);

// Node rejects header values containing any character outside \t, \x20-\x7e,
// \x80-\xff (ERR_INVALID_CHAR) — e.g. an em dash. Warning text is meant to be
// human-readable, not header-safe by construction, so strip anything outside
// that set rather than trust every warning source to stay ASCII forever.
// This is the ONLY thing standing between a bad warning string and a crash —
// Fastify's reply.header() is a plain synchronous assignment that never
// validates or throws; ERR_INVALID_CHAR is raised later, inside Fastify's
// send pipeline, after this handler has already returned — too late for a
// local try/catch here to ever catch it.
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7e\x80-\xff]/g, '?');
}

export function renderRoute(
  app: FastifyInstance,
  bridge: MermaidBridge,
  serverConfig: ServerConfig,
  cache: BoundedCache<RenderResult>
) {
  app.post(
    '/api/v1/render',
    {
      schema: {
        body: {
          type: 'object',
          required: ['diagram'],
          properties: {
            ...diagramInput.properties,
            outputFormat: { type: 'string', enum: ['svg', 'svg-string', 'png'], default: 'svg' },
          },
        },
        response: {
          400: errorResponse,
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { diagram, config, outputFormat = 'svg' } = request.body as RenderBody;

      if (outputFormat === 'png' && !serverConfig.png.enabled) {
        return reply.status(400).send({
          error: {
            code: 'PNG_DISABLED',
            message: 'PNG output is disabled on this server (PNG_ENABLED=false)',
          },
        });
      }

      const key = cacheKey({ diagram, config: config ?? {}, outputFormat });
      const cached = cache.get(key);
      try {
        const result = cached ? rewriteRenderId(cached) : await bridge.render(diagram, config);
        if (!cached && !NON_CACHEABLE_DIAGRAM_TYPES.has(result.diagramType)) {
          cache.set(key, result);
        }
        reply.header('X-Cache', cached ? 'HIT' : 'MISS');
        // JSON responses carry warnings inline; raw SVG/PNG bodies can't hold a
        // structured field, so the same information goes out as a header. Both
        // forms are additive — omitted entirely when there's nothing to report.
        if (result.warnings?.length) {
          reply.header('X-Mermaid-Warnings', sanitizeHeaderValue(result.warnings.join('; ')));
        }

        if (outputFormat === 'svg-string') {
          return {
            svg: result.svg,
            diagramType: result.diagramType,
            ...(result.warnings?.length ? { warnings: result.warnings } : {}),
          };
        }

        if (outputFormat === 'png') {
          return reply.type('image/png').send(svgToPng(result.svg));
        }

        return reply.type('image/svg+xml').send(result.svg);
      } catch (err) {
        const apiError = normalizeError(err);
        return reply.status(apiError.statusCode).send({ error: apiError });
      }
    }
  );
}
