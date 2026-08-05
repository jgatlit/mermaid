import type { MermaidBridge } from './mermaid-bridge.js';

export type Operation = 'parse' | 'detect' | 'render';

export interface OperationResult {
  diagramType: string;
  svg?: string;
  warnings?: string[];
}

// batch.ts and jobs.ts both dispatch the same parse/detect/render choice
// against the same MermaidBridge, previously as two independently
// hand-written if/else chains. That's how they drifted out of parity with
// /render: neither propagated warnings[] from parse/render, since fixing one
// never touched the other. One dispatch path, fixed once, for both.
export async function runOperation(
  bridge: MermaidBridge,
  operation: Operation,
  diagram: string,
  config?: Record<string, unknown>
): Promise<OperationResult> {
  if (operation === 'detect') {
    const diagramType = await bridge.detect(diagram);
    return { diagramType };
  }
  if (operation === 'parse') {
    const result = await bridge.parse(diagram, config);
    return { diagramType: result.diagramType, warnings: result.warnings };
  }
  const result = await bridge.render(diagram, config);
  return { diagramType: result.diagramType, svg: result.svg, warnings: result.warnings };
}
