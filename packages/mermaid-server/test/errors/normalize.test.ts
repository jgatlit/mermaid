import { describe, it, expect } from 'vitest';
import { normalizeError } from '../../src/errors/normalize.js';

describe('normalizeError', () => {
  it('normalizes UnknownDiagramError', () => {
    const err = new Error('No diagram type detected');
    err.name = 'UnknownDiagramError';
    const result = normalizeError(err);

    expect(result.code).toBe('UNKNOWN_DIAGRAM_TYPE');
    expect(result.statusCode).toBe(422);
    expect(result.message).toContain('No diagram type detected');
  });

  it('normalizes Jison DetailedError with hash', () => {
    const err: Record<string, unknown> = {
      str: 'Parse error on line 2',
      hash: {
        text: '',
        token: 'EOF',
        line: 2,
        loc: { first_line: 2, last_line: 2, first_column: 15, last_column: 15 },
        expected: ["'SEMI'", "'NEWLINE'"],
      },
      message: 'Parse error on line 2',
    };
    const result = normalizeError(err);

    expect(result.code).toBe('PARSE_ERROR');
    expect(result.statusCode).toBe(422);
    expect(result.details?.line).toBe(2);
    expect(result.details?.expected).toEqual(["'SEMI'", "'NEWLINE'"]);
  });

  it('normalizes generic Error', () => {
    const result = normalizeError(new Error('Something went wrong'));
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.statusCode).toBe(500);
  });

  it('normalizes non-Error values', () => {
    const result = normalizeError('string error');
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('string error');
  });
});
