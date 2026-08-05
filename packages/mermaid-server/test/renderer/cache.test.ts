import { describe, it, expect } from 'vitest';
import { BoundedCache, cacheKey } from '../../src/renderer/cache.js';

describe('cacheKey', () => {
  it('is stable for the same input', () => {
    const a = cacheKey({
      diagram: 'graph TD; A-->B',
      config: { theme: 'dark' },
      outputFormat: 'svg',
    });
    const b = cacheKey({
      diagram: 'graph TD; A-->B',
      config: { theme: 'dark' },
      outputFormat: 'svg',
    });
    expect(a).toBe(b);
  });

  it('is independent of object key order', () => {
    const a = cacheKey({
      diagram: 'graph TD; A-->B',
      config: { theme: 'dark', flowchart: { curve: 'basis' } },
      outputFormat: 'svg',
    });
    const b = cacheKey({
      config: { flowchart: { curve: 'basis' }, theme: 'dark' },
      outputFormat: 'svg',
      diagram: 'graph TD; A-->B',
    });
    expect(a).toBe(b);
  });

  it('differs when the diagram text differs', () => {
    const a = cacheKey({ diagram: 'graph TD; A-->B', config: {}, outputFormat: 'svg' });
    const b = cacheKey({ diagram: 'graph TD; A-->C', config: {}, outputFormat: 'svg' });
    expect(a).not.toBe(b);
  });

  it('differs when config differs', () => {
    const a = cacheKey({
      diagram: 'graph TD; A-->B',
      config: { theme: 'dark' },
      outputFormat: 'svg',
    });
    const b = cacheKey({
      diagram: 'graph TD; A-->B',
      config: { theme: 'forest' },
      outputFormat: 'svg',
    });
    expect(a).not.toBe(b);
  });

  it('differs when outputFormat differs', () => {
    const a = cacheKey({ diagram: 'graph TD; A-->B', config: {}, outputFormat: 'svg' });
    const b = cacheKey({ diagram: 'graph TD; A-->B', config: {}, outputFormat: 'svg-string' });
    expect(a).not.toBe(b);
  });

  it('is independent of key order at every nesting depth', () => {
    const a = cacheKey({
      diagram: 'x',
      config: { themeVariables: { primaryColor: '#111', lineColor: '#222' } },
      outputFormat: 'svg',
    });
    const b = cacheKey({
      diagram: 'x',
      config: { themeVariables: { lineColor: '#222', primaryColor: '#111' } },
      outputFormat: 'svg',
    });
    expect(a).toBe(b);
  });
});

describe('BoundedCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new BoundedCache<string>(10);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new BoundedCache<string>(10);
    cache.set('a', 'value-a');
    expect(cache.get('a')).toBe('value-a');
  });

  it('reports its size', () => {
    const cache = new BoundedCache<string>(10);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.size).toBe(2);
  });

  it('evicts the least-recently-used entry once maxSize is exceeded', () => {
    const cache = new BoundedCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3'); // evicts 'a', the oldest
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
    expect(cache.size).toBe(2);
  });

  it('touching an entry with get() protects it from eviction as the LRU', () => {
    const cache = new BoundedCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // 'a' is now most-recently-used; 'b' becomes the LRU
    cache.set('c', '3'); // evicts 'b', not 'a'
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  it('overwriting an existing key does not change size and refreshes recency', () => {
    const cache = new BoundedCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('a', '1-updated');
    expect(cache.size).toBe(2);
    cache.set('c', '3'); // 'b' is now the LRU since 'a' was refreshed
    expect(cache.get('a')).toBe('1-updated');
    expect(cache.get('b')).toBeUndefined();
  });

  it('treats maxSize 0 as caching disabled', () => {
    const cache = new BoundedCache<string>(0);
    cache.set('a', '1');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
