import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join } from 'node:path';
import { MermaidBridge, type ParseResult, type RenderResult } from './renderer/mermaid-bridge.js';
import { BoundedCache } from './renderer/cache.js';
import { FileStore } from './storage/store.js';
import { loadConfig, type ServerConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { detectRoute } from './routes/detect.js';
import { parseRoute } from './routes/parse.js';
import { renderRoute } from './routes/render.js';
import { extractRoute } from './routes/extract.js';
import { batchRoute } from './routes/batch.js';
import { jobRoutes } from './routes/jobs.js';
import { normalizeError } from './errors/normalize.js';

export async function buildApp(config: ServerConfig = loadConfig()) {
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

  const renderCache = new BoundedCache<RenderResult>(config.cache.size);
  const parseCache = new BoundedCache<ParseResult>(config.cache.size);

  healthRoutes(app, bridge, config);
  detectRoute(app, bridge);
  parseRoute(app, bridge, parseCache);
  renderRoute(app, bridge, config, renderCache);
  extractRoute(app, bridge);
  batchRoute(app, bridge);
  jobRoutes(app, bridge, store);

  return app;
}
