import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { normalizeError } from '../errors/normalize.js';
import { diagramInput, errorResponse } from '../schemas/common.js';

export function parseRoute(app: FastifyInstance, bridge: MermaidBridge) {
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
            },
          },
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { diagram, config } = request.body as {
        diagram: string;
        config?: Record<string, unknown>;
      };
      try {
        const result = await bridge.parse(diagram, config);
        return { valid: true, ...result };
      } catch (err) {
        const apiError = normalizeError(err);
        return reply.status(apiError.statusCode).send({ error: apiError });
      }
    }
  );
}
