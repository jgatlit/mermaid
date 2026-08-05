export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
  mermaid: {
    theme: string;
    securityLevel: string;
    maxTextSize: number;
  };
  png: {
    enabled: boolean;
    poolSize: number;
    timeout: number;
  };
  batch: {
    maxItems: number;
  };
  cache: {
    size: number;
  };
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    mermaid: {
      theme: process.env.MERMAID_THEME ?? 'default',
      securityLevel: process.env.MERMAID_SECURITY_LEVEL ?? 'strict',
      maxTextSize: parseInt(process.env.MERMAID_MAX_TEXT_SIZE ?? '50000', 10),
    },
    png: {
      enabled: process.env.PNG_ENABLED !== 'false',
      poolSize: parseInt(process.env.PNG_POOL_SIZE ?? '4', 10),
      timeout: parseInt(process.env.PNG_TIMEOUT ?? '30000', 10),
    },
    batch: {
      maxItems: parseInt(process.env.BATCH_MAX_ITEMS ?? '50', 10),
    },
    cache: {
      // Entries per cache (render and parse are cached separately, each
      // capped at this size). 0 disables caching.
      size: parseInt(process.env.MERMAID_CACHE_SIZE ?? '200', 10),
    },
  };
}
