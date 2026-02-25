import { describe, it, expect, beforeAll } from 'vitest';
import { MermaidBridge } from '../../src/renderer/mermaid-bridge.js';

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
  });
});
