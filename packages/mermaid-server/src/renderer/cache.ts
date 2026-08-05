import { createHash } from 'node:crypto';

/**
 * JSON.stringify serializes object keys in insertion order, so two requests
 * carrying the same config with keys typed in a different order would
 * otherwise produce different cache keys and silently miss the cache.
 * Sorting keys recursively — including inside nested config blocks like
 * `themeVariables` — makes the serialization order-independent.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Stable cache key for a request shape, e.g. `{ diagram, config, outputFormat }`.
 * Hashed (rather than used as a raw JSON string) so Map key comparisons stay
 * cheap even for diagrams near the 50,000-character request limit.
 */
export function cacheKey(parts: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalize(parts));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Minimal bounded LRU cache. `Map` iterates in insertion order, and both
 * `get` and `set` re-insert their key — so the oldest key in iteration order
 * is always the least-recently-used one, without a separate linked list.
 * `maxSize <= 0` disables caching entirely (every `set` is a no-op).
 */
export class BoundedCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.maxSize <= 0) {
      return;
    }
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
