import { describe, it, expect, beforeAll } from 'vitest';
import { MermaidBridge, rewriteRenderId } from '../../src/renderer/mermaid-bridge.js';

describe('MermaidBridge', () => {
  let bridge: MermaidBridge;

  beforeAll(async () => {
    bridge = new MermaidBridge();
    await bridge.initialize();
  });

  describe('detect', () => {
    it('detects flowchart type', async () => {
      const result = await bridge.detect('graph TD; A-->B');
      expect(result).toMatch(/flowchart/);
    });

    it('detects sequence diagram type', async () => {
      const result = await bridge.detect('sequenceDiagram\n  Alice->>Bob: Hi');
      expect(result).toMatch(/sequence/);
    });

    it('throws for unknown diagram type', async () => {
      await expect(bridge.detect('not a diagram at all')).rejects.toThrow();
    });
  });

  describe('parse', () => {
    it('parses valid flowchart', async () => {
      const result = await bridge.parse('graph TD; A-->B');
      expect(result.diagramType).toMatch(/flowchart/);
    });

    it('throws for invalid syntax', async () => {
      await expect(bridge.parse('graph TD;\n  A-->')).rejects.toThrow();
    });

    it('omits ast fields when not requested', async () => {
      const result = await bridge.parse('pie\n"A": 40\n"B": 60');
      expect(result.ast).toBeUndefined();
      expect(result.astSupported).toBeUndefined();
    });

    it('returns a sanitized AST for a Langium-backed diagram type when ast is requested', async () => {
      const result = await bridge.parse('pie\n"A": 40\n"B": 60', undefined, { ast: true });
      expect(result.astSupported).toBe(true);
      expect(result.ast).toBeDefined();
      expect(() => JSON.stringify(result.ast)).not.toThrow();
      expect((result.ast as { $type?: string }).$type).toBe('Pie');
      expect(JSON.stringify(result.ast)).not.toContain('$cstNode');
      expect(JSON.stringify(result.ast)).not.toContain('$container');
    });

    it('reports astSupported: false and omits ast for Jison-backed diagram types', async () => {
      const result = await bridge.parse('graph TD; A-->B', undefined, { ast: true });
      expect(result.astSupported).toBe(false);
      expect(result.ast).toBeUndefined();
    });
  });

  describe('render', () => {
    it('renders flowchart to SVG string', async () => {
      const result = await bridge.render('graph TD; A-->B');
      expect(result.svg).toContain('<svg');
      expect(result.svg).toContain('</svg>');
      expect(result.diagramType).toMatch(/flowchart/);
    });

    it('renders sequence diagram', async () => {
      const result = await bridge.render('sequenceDiagram\n  Alice->>Bob: Hello');
      expect(result.svg).toContain('<svg');
      expect(result.diagramType).toMatch(/sequence/);
    });

    it('applies theme config override', async () => {
      const result = await bridge.render('graph TD; A-->B', { theme: 'dark' });
      expect(result.svg).toContain('<svg');
    });

    it('normalizes a literal \\n in a flowchart label to <br/> and warns', async () => {
      const result = await bridge.render('flowchart TD\n  A["One\\nTwo"] --> B');
      expect(result.svg).not.toContain('\\n');
      expect(result.svg).toContain('One');
      expect(result.svg).toContain('Two');
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.some((w) => w.includes('\\n'))).toBe(true);
    });

    it('does not touch a real newline (statement separator) between flowchart lines', async () => {
      const result = await bridge.render('flowchart TD\n  A-->B\n  B-->C');
      expect(result.diagramType).toMatch(/flowchart/);
      expect(result.warnings).toBeUndefined();
    });

    it('does not normalize a literal \\n outside flowchart diagrams', async () => {
      const result = await bridge.render('sequenceDiagram\n  Alice->>Bob: One\\nTwo');
      expect(result.warnings).toBeUndefined();
    });

    it('produces no warnings when nothing needed rewriting', async () => {
      const result = await bridge.render('graph TD; A-->B');
      expect(result.warnings).toBeUndefined();
    });

    it('warns when a blocked config key is actually present, silently otherwise', async () => {
      const withBlocked = await bridge.render('graph TD; A-->B', {
        theme: 'dark',
        securityLevel: 'loose',
      } as never);
      expect(withBlocked.warnings).toBeDefined();
      expect(withBlocked.warnings?.some((w) => w.includes('securityLevel'))).toBe(true);

      const withoutBlocked = await bridge.render('graph TD; A-->B', { theme: 'dark' });
      expect(withoutBlocked.warnings).toBeUndefined();
    });

    it('warns when htmlLabels resolves truthy, silently otherwise', async () => {
      const withHtmlLabels = await bridge.render('graph TD; A-->B', {
        htmlLabels: true,
      } as never);
      expect(withHtmlLabels.warnings).toBeDefined();
      expect(withHtmlLabels.warnings?.some((w) => w.includes('htmlLabels'))).toBe(true);

      const withoutHtmlLabels = await bridge.render('graph TD; A-->B', { theme: 'dark' });
      expect(withoutHtmlLabels.warnings).toBeUndefined();
    });
  });

  describe('rewriteRenderId', () => {
    it('replaces every occurrence of the root id with a fresh, distinct one', async () => {
      const original = await bridge.render('flowchart TD\n  A-->B');
      const originalId = /^<svg[^>]*\sid="([^"]+)"/.exec(original.svg)?.[1];
      expect(originalId).toBeDefined();

      const rewritten = rewriteRenderId(original);
      const rewrittenId = /^<svg[^>]*\sid="([^"]+)"/.exec(rewritten.svg)?.[1];

      expect(rewrittenId).toBeDefined();
      expect(rewrittenId).not.toBe(originalId);
      expect(rewritten.svg).not.toContain(originalId!);
      expect(rewritten.svg.split(rewrittenId!).length).toBeGreaterThan(1);
      // structurally identical apart from the id
      expect(rewritten.svg.replaceAll(rewrittenId!, 'X')).toBe(
        original.svg.replaceAll(originalId!, 'X')
      );
    });

    it('is a no-op when the svg has no root id attribute', () => {
      const result = { svg: '<svg></svg>', diagramType: 'flowchart' };
      expect(rewriteRenderId(result)).toEqual(result);
    });
  });
});
