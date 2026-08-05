import { describe, it, expect } from 'vitest';
import { normalizeError } from '../../src/errors/normalize.js';
import { RenderTimeoutError } from '../../src/renderer/queue.js';

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

  it('normalizes splitLineToFitWidth newline-in-label error as RENDER_ERROR, not INTERNAL_ERROR', () => {
    // Thrown by mermaid core when markdown list markup expands into embedded
    // newlines in a label wide enough to need word-wrapping. This is client
    // input, not a server crash, but mermaid's parser accepts the diagram —
    // the failure only surfaces during layout, so it isn't a PARSE_ERROR either.
    const err = new Error('splitLineToFitWidth does not support newlines in the line');
    const result = normalizeError(err);

    expect(result.code).toBe('RENDER_ERROR');
    expect(result.statusCode).toBe(422);
  });

  it('still normalizes an unrelated generic Error as INTERNAL_ERROR (no over-broad matching)', () => {
    const result = normalizeError(
      new TypeError("Cannot read properties of undefined (reading 'h')")
    );
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.statusCode).toBe(500);
  });

  it('normalizes RenderTimeoutError as RENDER_TIMEOUT with 503, not a generic 500', () => {
    const result = normalizeError(new RenderTimeoutError(15_000));

    expect(result.code).toBe('RENDER_TIMEOUT');
    expect(result.statusCode).toBe(503);
    expect(result.message).toContain('15000');
  });

  it('normalizes non-Error values', () => {
    const result = normalizeError('string error');
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('string error');
  });
});
