import type { FastifyInstance } from 'fastify';
import type { MermaidBridge } from '../renderer/mermaid-bridge.js';
import { normalizeError } from '../errors/normalize.js';

interface ExtractBody {
  markdown: string;
  validate?: boolean;
}

interface ExtractedDiagram {
  index: number;
  diagram: string;
  line: number;
  diagramType?: string;
  valid?: boolean;
  error?: string;
}

const MERMAID_BLOCK_RE = /```mermaid\s*\n([\S\s]*?)```/g;

function extractMermaidBlocks(markdown: string): { diagram: string; line: number }[] {
  const blocks: { diagram: string; line: number }[] = [];
  let match;

  while ((match = MERMAID_BLOCK_RE.exec(markdown)) !== null) {
    const beforeMatch = markdown.slice(0, match.index);
    const line = beforeMatch.split('\n').length;
    blocks.push({ diagram: match[1].trim(), line });
  }

  // Reset regex lastIndex for reuse
  MERMAID_BLOCK_RE.lastIndex = 0;
  return blocks;
}

export function extractRoute(app: FastifyInstance, bridge: MermaidBridge) {
  app.post(
    '/api/v1/extract',
    {
      schema: {
        body: {
          type: 'object',
          required: ['markdown'],
          properties: {
            markdown: { type: 'string', maxLength: 500000 },
            validate: { type: 'boolean', default: false },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              diagrams: { type: 'array' },
              count: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const { markdown, validate = false } = request.body as ExtractBody;
      const blocks = extractMermaidBlocks(markdown);

      const diagrams: ExtractedDiagram[] = [];

      for (const [i, block] of blocks.entries()) {
        const entry: ExtractedDiagram = {
          index: i,
          diagram: block.diagram,
          line: block.line,
        };

        if (validate) {
          try {
            const result = await bridge.parse(block.diagram);
            entry.diagramType = result.diagramType;
            entry.valid = true;
          } catch (err) {
            entry.valid = false;
            entry.error = normalizeError(err).message;
          }
        }

        diagrams.push(entry);
      }

      return { diagrams, count: diagrams.length };
    }
  );
}
