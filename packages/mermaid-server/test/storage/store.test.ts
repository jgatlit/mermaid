import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../../src/storage/store.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = join(import.meta.dirname, '../../.test-data');

describe('FileStore', () => {
  let store: FileStore;

  beforeEach(async () => {
    store = new FileStore(TEST_DATA_DIR);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('creates directory structure on initialize', () => {
    const dirs = store.listStages();
    expect(dirs).toEqual(['input', 'staged', 'output', 'archive']);
  });

  it('writes input and returns job ID', async () => {
    const jobId = await store.writeInput('graph TD; A-->B', { source: 'api' });
    expect(jobId).toMatch(/^[\da-f-]+$/);

    const content = await store.readJobFile(jobId, 'input', 'diagram.mmd');
    expect(content).toBe('graph TD; A-->B');
  });

  it('moves job through stages', async () => {
    const jobId = await store.writeInput('graph TD; A-->B');

    await store.moveToStage(jobId, 'staged');
    expect(await store.getJobStage(jobId)).toBe('staged');

    await store.writeOutput(jobId, 'diagram.svg', '<svg></svg>');
    await store.moveToStage(jobId, 'output');
    expect(await store.getJobStage(jobId)).toBe('output');

    const svg = await store.readJobFile(jobId, 'output', 'diagram.svg');
    expect(svg).toBe('<svg></svg>');
  });

  it('archives a completed job', async () => {
    const jobId = await store.writeInput('graph TD; A-->B');
    await store.moveToStage(jobId, 'output');
    await store.archive(jobId);
    expect(await store.getJobStage(jobId)).toBe('archive');
  });

  it('lists jobs by stage', async () => {
    const id1 = await store.writeInput('graph TD; A-->B');
    const id2 = await store.writeInput('pie\n  "A": 50');
    await store.moveToStage(id1, 'staged');

    const inputJobs = await store.listJobs('input');
    const stagedJobs = await store.listJobs('staged');
    expect(inputJobs).toContain(id2);
    expect(stagedJobs).toContain(id1);
  });

  it('writes and reads job metadata', async () => {
    const jobId = await store.writeInput('graph TD; A-->B', { source: 'api', theme: 'dark' });
    const meta = await store.readMetadata(jobId);
    expect(meta.source).toBe('api');
    expect(meta.theme).toBe('dark');
    expect(meta).toHaveProperty('createdAt');
  });
});
