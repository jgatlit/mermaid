import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Job endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('submits a job and returns job ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { diagram: 'graph TD; A-->B', operation: 'render' },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('jobId');
    expect(body.status).toBe('processing');
  });

  it('retrieves a completed job', async () => {
    // Submit
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { diagram: 'graph TD; A-->B', operation: 'render' },
    });
    const { jobId } = JSON.parse(submitRes.payload);

    // Wait briefly for async processing
    await new Promise((r) => setTimeout(r, 1500));

    // Get result
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const body = JSON.parse(getRes.payload);
    expect(body.status).toBe('completed');
    expect(body.result).toHaveProperty('svg');
    expect(body.result.svg).toContain('<svg');
  });

  it('lists recent jobs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/jobs' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.jobs).toBeInstanceOf(Array);
  });

  it('archives a completed job', async () => {
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { diagram: 'pie\n  "A": 50', operation: 'render' },
    });
    const { jobId } = JSON.parse(submitRes.payload);
    await new Promise((r) => setTimeout(r, 1500));

    const archiveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/archive`,
    });
    expect(archiveRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
    });
    expect(JSON.parse(getRes.payload).status).toBe('archived');
  });

  it('returns 404 for nonexistent job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    // Shape parity with /render's and /batch's error envelope (ApiError:
    // code + message + statusCode) - jobs.ts used to hand-build this body
    // without the statusCode field.
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.statusCode).toBe(404);
  });

  it('returns the same ApiError shape for a 404 on archive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000/archive',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.statusCode).toBe(404);
  });

  it('records render warnings in job metadata (parity with /render and /batch)', async () => {
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        diagram: 'graph TD; A-->B',
        operation: 'render',
        config: { htmlLabels: true },
      },
    });
    const { jobId } = JSON.parse(submitRes.payload);
    await new Promise((r) => setTimeout(r, 1500));

    const getRes = await app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}` });
    const body = JSON.parse(getRes.payload);
    expect(body.status).toBe('completed');
    expect(body.metadata.warnings).toBeDefined();
    expect(body.metadata.warnings.some((w: string) => w.includes('htmlLabels'))).toBe(true);
  });

  it('rejects path traversal in job ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/../../etc/passwd',
    });
    expect(res.statusCode).toBe(404);
  });
});
