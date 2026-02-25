import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

const DIAGRAM_FILES = [
  'flowchart',
  'sequence',
  'class',
  'er',
  'gantt',
  'git',
  'pie',
  'state',
  'journey',
  'timeline',
  'c4',
  'kanban',
  'sankey',
  'quadrant',
  'xychart',
  'block',
  'packet',
  'requirement',
  'info',
];

describe('Diagram corpus — render all types', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  for (const name of DIAGRAM_FILES) {
    it(`renders ${name} diagram`, async () => {
      const diagram = await readFile(join(FIXTURES_DIR, `${name}.mmd`), 'utf-8');

      // Parse should succeed
      const parseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/parse',
        payload: { diagram },
      });
      expect(parseRes.statusCode).toBe(200);

      // Render should produce SVG
      const renderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/render',
        payload: { diagram, outputFormat: 'svg-string' },
      });
      expect(renderRes.statusCode).toBe(200);
      const body = JSON.parse(renderRes.payload);
      expect(body.svg).toContain('<svg');
    });
  }
});
