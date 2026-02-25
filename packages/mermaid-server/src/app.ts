import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join } from 'node:path';
import { MermaidBridge } from './renderer/mermaid-bridge.js';
import { FileStore } from './storage/store.js';
import { healthRoutes } from './routes/health.js';
import { detectRoute } from './routes/detect.js';
import { parseRoute } from './routes/parse.js';
import { renderRoute } from './routes/render.js';
import { extractRoute } from './routes/extract.js';
import { batchRoute } from './routes/batch.js';
import { jobRoutes } from './routes/jobs.js';
import { normalizeError } from './errors/normalize.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Mermaid Server API',
        description: 'HTTP API for rendering Mermaid diagrams',
        version: '0.1.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    const apiError = normalizeError(error);
    reply.status(apiError.statusCode).send({ error: apiError });
  });

  const bridge = new MermaidBridge();
  await bridge.initialize();

  const store = new FileStore(join(process.cwd(), 'data'));
  await store.initialize();

  await healthRoutes(app, bridge);
  await detectRoute(app, bridge);
  await parseRoute(app, bridge);
  await renderRoute(app, bridge);
  await extractRoute(app, bridge);
  await batchRoute(app, bridge);
  await jobRoutes(app, bridge, store);

  return app;
}
