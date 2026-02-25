import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { normalizeError } from '../errors/normalize.js';
import { diagramInput, errorResponse } from '../schemas/common.js';

export function detectRoute(app: FastifyInstance, bridge: MermaidBridge) {
  app.post(
    '/api/v1/detect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['diagram'],
          properties: { diagram: diagramInput.properties.diagram },
        },
        response: {
          200: { type: 'object', properties: { diagramType: { type: 'string' } } },
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { diagram } = request.body as { diagram: string };
      try {
        const diagramType = await bridge.detect(diagram);
        return { diagramType };
      } catch (err) {
        const apiError = normalizeError(err);
        return reply.status(apiError.statusCode).send({ error: apiError });
      }
    }
  );
}
