import { mkdir, writeFile, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STAGES = ['input', 'staged', 'output', 'archive'] as const;
type Stage = (typeof STAGES)[number];

const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function validateJobId(jobId: string): void {
  if (!UUID_RE.test(jobId)) {
    throw new Error(`Invalid job ID format: ${jobId}`);
  }
}

interface JobMetadata {
  createdAt: string;
  stage: Stage;
  [key: string]: unknown;
}

export class FileStore {
  constructor(private baseDir: string) {}

  async initialize(): Promise<void> {
    for (const stage of STAGES) {
      await mkdir(join(this.baseDir, stage), { recursive: true });
    }
  }

  listStages(): string[] {
    return [...STAGES];
  }

  async writeInput(diagram: string, meta?: Record<string, unknown>): Promise<string> {
    const jobId = randomUUID();
    const jobDir = join(this.baseDir, 'input', jobId);
    await mkdir(jobDir, { recursive: true });

    await writeFile(join(jobDir, 'diagram.mmd'), diagram, 'utf-8');

    const metadata: JobMetadata = {
      createdAt: new Date().toISOString(),
      stage: 'input',
      ...meta,
    };
    await writeFile(join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    return jobId;
  }

  async writeOutput(jobId: string, filename: string, content: string | Buffer): Promise<void> {
    validateJobId(jobId);
    const stage = await this.getJobStage(jobId);
    const jobDir = join(this.baseDir, stage, jobId);
    await writeFile(join(jobDir, filename), content);
  }

  async readJobFile(jobId: string, stage: Stage, filename: string): Promise<string>;
  async readJobFile(jobId: string, stage: Stage, filename: string, encoding: null): Promise<Buffer>;
  async readJobFile(
    jobId: string,
    stage: Stage,
    filename: string,
    encoding: BufferEncoding | null = 'utf-8'
  ): Promise<string | Buffer> {
    validateJobId(jobId);
    const path = join(this.baseDir, stage, jobId, filename);
    return encoding === null ? readFile(path) : readFile(path, encoding);
  }

  async readMetadata(jobId: string): Promise<JobMetadata> {
    validateJobId(jobId);
    const stage = await this.getJobStage(jobId);
    const raw = await readFile(join(this.baseDir, stage, jobId, 'metadata.json'), 'utf-8');
    return JSON.parse(raw);
  }

  async getJobStage(jobId: string): Promise<Stage> {
    validateJobId(jobId);
    for (const stage of STAGES) {
      try {
        await stat(join(this.baseDir, stage, jobId));
        return stage;
      } catch {
        // not in this stage
      }
    }
    throw new Error(`Job ${jobId} not found in any stage`);
  }

  async moveToStage(jobId: string, target: Stage): Promise<void> {
    validateJobId(jobId);
    const current = await this.getJobStage(jobId);
    if (current === target) {
      return;
    }

    const src = join(this.baseDir, current, jobId);
    const dest = join(this.baseDir, target, jobId);
    await rename(src, dest);

    // Update metadata
    const metaPath = join(dest, 'metadata.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    meta.stage = target;
    meta[`${target}At`] = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async archive(jobId: string): Promise<void> {
    await this.moveToStage(jobId, 'archive');
  }

  async listJobs(stage: Stage): Promise<string[]> {
    try {
      return await readdir(join(this.baseDir, stage));
    } catch {
      return [];
    }
  }
}
