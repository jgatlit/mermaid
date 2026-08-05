import { describe, it, expect } from 'vitest';
import { sanitizeHeaderValue } from '../../src/routes/render.js';

// Node's actual header-value validator (lib/_http_common.js headerCharRegex):
// only \t, \x20-\x7e, and \x80-\xff are legal. Mirrored here so this test
// fails if sanitizeHeaderValue's own regex ever drifts from Node's.
const NODE_HEADER_SAFE = /^[\t\x20-\x7e\x80-\xff]*$/;

describe('sanitizeHeaderValue', () => {
  it('leaves an already-safe ASCII string untouched', () => {
    const value = 'Config key "securityLevel" was removed - not permitted in this server context.';
    expect(sanitizeHeaderValue(value)).toBe(value);
  });

  // The actual P0: this exact em dash, in this exact position, crashed
  // reply.header() with ERR_INVALID_CHAR before the fix.
  it('replaces an em dash (the original P0 trigger character)', () => {
    const result = sanitizeHeaderValue('Config key "logLevel" was removed — not permitted.');
    expect(result).not.toContain('—');
    expect(NODE_HEADER_SAFE.test(result)).toBe(true);
  });

  it('replaces characters outside the Latin-1 range (e.g. CJK, emoji)', () => {
    const result = sanitizeHeaderValue('warning: 警告 ⚠️ done');
    expect(NODE_HEADER_SAFE.test(result)).toBe(true);
  });

  it('replaces embedded CR/LF, which would otherwise enable header injection', () => {
    const result = sanitizeHeaderValue('line one\r\nX-Injected: evil');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(NODE_HEADER_SAFE.test(result)).toBe(true);
  });

  it('preserves the Latin-1 supplement range (\\x80-\\xff), which Node allows', () => {
    const value = 'café résumé';
    expect(sanitizeHeaderValue(value)).toBe(value);
  });
});
