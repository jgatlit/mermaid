import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import type { FileStore } from '../storage/store.js';
import { normalizeError } from '../errors/normalize.js';

interface JobSubmitBody {
  diagram: string;
  operation?: 'parse' | 'detect' | 'render';
  config?: Record<string, unknown>;
}

export function jobRoutes(app: FastifyInstance, bridge: MermaidBridge, store: FileStore) {
  // Submit a new job
  app.post(
    '/api/v1/jobs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['diagram'],
          properties: {
            diagram: { type: 'string', maxLength: 50000 },
            operation: { type: 'string', enum: ['parse', 'detect', 'render'], default: 'render' },
            config: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const { diagram, operation = 'render', config } = request.body as JobSubmitBody;

      const jobId = await store.writeInput(diagram, { operation, config, status: 'processing' });

      // Process asynchronously (fire-and-forget)
      processJob(jobId, diagram, operation, config, bridge, store).catch((err) => {
        app.log.error({ jobId, err }, 'Job processing failed');
      });

      return reply.status(202).send({
        jobId,
        status: 'processing',
        url: `/api/v1/jobs/${jobId}`,
      });
    }
  );

  // Get job status/result
  app.get(
    '/api/v1/jobs/:jobId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
      },
    },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      try {
        const meta = await store.readMetadata(jobId);
        const stage = await store.getJobStage(jobId);

        const response: Record<string, unknown> = {
          jobId,
          status:
            stage === 'output' ? 'completed' : stage === 'archive' ? 'archived' : 'processing',
          metadata: meta,
        };

        if (stage === 'output' || stage === 'archive') {
          try {
            const svg = await store.readJobFile(jobId, stage, 'diagram.svg');
            response.result = { svg, diagramType: meta.diagramType };
          } catch {
            // No SVG output (parse/detect operation)
            response.result = { diagramType: meta.diagramType };
          }
        }

        return response;
      } catch {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: `Job ${jobId} not found` } });
      }
    }
  );

  // List jobs
  app.get('/api/v1/jobs', async () => {
    const stages = ['input', 'staged', 'output', 'archive'] as const;
    const jobs: { jobId: string; stage: string }[] = [];
    for (const stage of stages) {
      const ids = await store.listJobs(stage);
      for (const id of ids) {
        jobs.push({ jobId: id, stage });
      }
    }
    return { jobs, total: jobs.length };
  });

  // Archive a job
  app.post(
    '/api/v1/jobs/:jobId/archive',
    {
      schema: {
        params: {
          type: 'object',
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
      },
    },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      try {
        await store.archive(jobId);
        return { jobId, status: 'archived' };
      } catch {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: `Job ${jobId} not found` } });
      }
    }
  );
}

async function processJob(
  jobId: string,
  diagram: string,
  operation: string,
  config: Record<string, unknown> | undefined,
  bridge: MermaidBridge,
  store: FileStore
) {
  try {
    await store.moveToStage(jobId, 'staged');

    if (operation === 'detect') {
      const diagramType = await bridge.detect(diagram);
      const meta = await store.readMetadata(jobId);
      meta.diagramType = diagramType;
      meta.status = 'completed';
      await store.writeOutput(jobId, 'metadata.json', JSON.stringify(meta, null, 2));
    } else if (operation === 'parse') {
      const result = await bridge.parse(diagram, config);
      const meta = await store.readMetadata(jobId);
      meta.diagramType = result.diagramType;
      meta.status = 'completed';
      await store.writeOutput(jobId, 'metadata.json', JSON.stringify(meta, null, 2));
    } else {
      const result = await bridge.render(diagram, config);
      await store.writeOutput(jobId, 'diagram.svg', result.svg);
      const meta = await store.readMetadata(jobId);
      meta.diagramType = result.diagramType;
      meta.status = 'completed';
      await store.writeOutput(jobId, 'metadata.json', JSON.stringify(meta, null, 2));
    }

    await store.moveToStage(jobId, 'output');
  } catch (err) {
    // Write error to metadata
    try {
      const meta = await store.readMetadata(jobId);
      meta.status = 'failed';
      meta.error = normalizeError(err);
      await store.writeOutput(jobId, 'metadata.json', JSON.stringify(meta, null, 2));
      await store.moveToStage(jobId, 'output');
    } catch {
      // Best effort
    }
  }
}
