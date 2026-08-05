import type { FastifyInstance } from 'fastify';
import type { MermaidBridge, ParseResult } from '../renderer/mermaid-bridge.js';
import type { BoundedCache } from '../renderer/cache.js';
import { cacheKey } from '../renderer/cache.js';
import { normalizeError } from '../errors/normalize.js';
import { diagramInput, errorResponse } from '../schemas/common.js';

export function parseRoute(
  app: FastifyInstance,
  bridge: MermaidBridge,
  cache: BoundedCache<ParseResult>
) {
  app.post(
    '/api/v1/parse',
    {
      schema: {
        body: diagramInput,
        response: {
          200: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              diagramType: { type: 'string' },
              config: { type: 'object', additionalProperties: true },
              astSupported: { type: 'boolean' },
              ast: { type: 'object', additionalProperties: true },
              warnings: { type: 'array', items: { type: 'string' } },
            },
          },
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { diagram, config, ast } = request.body as {
        diagram: string;
        config?: Record<string, unknown>;
        ast?: boolean;
      };
      // `ast` must be part of the key — otherwise a plain request that populates
      // the cache would produce a false HIT (silently missing ast/astSupported)
      // for a later request asking for the AST of the same diagram+config.
      const key = cacheKey({ diagram, config: config ?? {}, ast: ast ?? false });
      const cached = cache.get(key);
      try {
        const result = cached ?? (await bridge.parse(diagram, config, { ast }));
        if (!cached) {
          cache.set(key, result);
        }
        reply.header('X-Cache', cached ? 'HIT' : 'MISS');
        return { valid: true, ...result };
      } catch (err) {
        const apiError = normalizeError(err);
        return reply.status(apiError.statusCode).send({ error: apiError });
      }
    }
  );
}
