import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { normalizeError } from '../errors/normalize.js';
import { diagramInput, errorResponse } from '../schemas/common.js';

interface RenderBody {
  diagram: string;
  config?: Record<string, unknown>;
  outputFormat?: 'svg' | 'svg-string';
}

export function renderRoute(app: FastifyInstance, bridge: MermaidBridge) {
  app.post(
    '/api/v1/render',
    {
      schema: {
        body: {
          type: 'object',
          required: ['diagram'],
          properties: {
            ...diagramInput.properties,
            outputFormat: { type: 'string', enum: ['svg', 'svg-string'], default: 'svg' },
          },
        },
        response: {
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { diagram, config, outputFormat = 'svg' } = request.body as RenderBody;
      try {
        const result = await bridge.render(diagram, config);

        if (outputFormat === 'svg-string') {
          return { svg: result.svg, diagramType: result.diagramType };
        }

        return reply.type('image/svg+xml').send(result.svg);
      } catch (err) {
        const apiError = normalizeError(err);
        return reply.status(apiError.statusCode).send({ error: apiError });
      }
    }
  );
}
