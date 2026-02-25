import type { MermaidConfig } from 'mermaid';
import { withEnvironment } from './environment.js';
import { RenderQueue } from './queue.js';

export interface ParseResult {
  diagramType: string;
  config: MermaidConfig;
}

export interface RenderResult {
  svg: string;
  diagramType: string;
}

interface MermaidModule {
  default: {
    initialize: (config: MermaidConfig) => void;
    detectType: (text: string) => string;
    parse: (text: string) => Promise<ParseResult>;
    render: (id: string, text: string) => Promise<RenderResult>;
    mermaidAPI: { reset: () => void };
    getRegisteredDiagramsMetadata: () => { id: string }[];
  };
}

const BLOCKED_CONFIG_KEYS = ['securityLevel', 'secure', 'maxTextSize', 'logLevel', 'startOnLoad'];

function sanitizeConfig(config: MermaidConfig): MermaidConfig {
  const sanitized = { ...config };
  for (const key of BLOCKED_CONFIG_KEYS) {
    delete (sanitized as Record<string, unknown>)[key];
  }
  return sanitized;
}

let renderCounter = 0;

export class MermaidBridge {
  private queue = new RenderQueue();
  private mermaidModule: MermaidModule | null = null;
  private initialized = false;
  private defaultConfig: MermaidConfig;

  constructor(config?: Partial<MermaidConfig>) {
    this.defaultConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      logLevel: 'error',
      htmlLabels: false, // Prefer SVG <text> labels in server context
      gantt: { useWidth: 960 }, // Default viewport width for server rendering
      theme: config?.theme ?? 'default',
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.queue.run(() =>
      withEnvironment(async () => {
        this.mermaidModule = await import('mermaid');
        this.mermaidModule.default.initialize(this.defaultConfig);
        this.initialized = true;
      })
    );
  }

  private getMermaid() {
    if (!this.mermaidModule) {
      throw new Error('MermaidBridge not initialized. Call initialize() first.');
    }
    return this.mermaidModule.default;
  }

  async detect(text: string): Promise<string> {
    return this.queue.run(() =>
      withEnvironment(() => {
        const mermaid = this.getMermaid();
        return mermaid.detectType(text);
      })
    );
  }

  async parse(text: string, config?: MermaidConfig): Promise<ParseResult> {
    return this.queue.run(() =>
      withEnvironment(async () => {
        const mermaid = this.getMermaid();
        try {
          if (config) {
            mermaid.initialize({ ...this.defaultConfig, ...sanitizeConfig(config) });
          }
          const result = await mermaid.parse(text);
          return result;
        } finally {
          mermaid.mermaidAPI.reset();
          if (config) {
            mermaid.initialize(this.defaultConfig);
          }
        }
      })
    );
  }

  async render(text: string, config?: MermaidConfig): Promise<RenderResult> {
    return this.queue.run(() =>
      withEnvironment(async () => {
        const mermaid = this.getMermaid();
        const id = `mermaid-server-${++renderCounter}`;
        try {
          if (config) {
            mermaid.initialize({ ...this.defaultConfig, ...sanitizeConfig(config) });
          }
          const result = await mermaid.render(id, text);
          return {
            svg: result.svg,
            diagramType: result.diagramType,
          };
        } finally {
          mermaid.mermaidAPI.reset();
          if (config) {
            mermaid.initialize(this.defaultConfig);
          }
        }
      })
    );
  }

  async getDiagramTypes(): Promise<{ id: string }[]> {
    return this.queue.run(() =>
      withEnvironment(() => {
        const mermaid = this.getMermaid();
        return mermaid.getRegisteredDiagramsMetadata();
      })
    );
  }
}
