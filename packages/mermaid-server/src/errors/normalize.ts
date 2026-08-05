export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: {
    line?: number;
    column?: number;
    token?: string;
    expected?: string[];
  };
}

interface DetailedError {
  str?: string;
  hash?: {
    text?: string;
    token?: string;
    line?: number;
    loc?: { first_line?: number; last_line?: number; first_column?: number; last_column?: number };
    expected?: string[];
  };
  message?: string;
}

function isDetailedError(err: unknown): err is DetailedError {
  return typeof err === 'object' && err !== null && 'hash' in err;
}

// Render-time throws caused by unsupported label *content*, not diagram syntax —
// mermaid's parser accepts these diagrams, so the failure only surfaces once
// layout runs (which is also why /api/v1/parse can't catch them; see REFERENCE.md).
// Add new substrings here as more of these are characterised.
const KNOWN_RENDER_INPUT_ERRORS = [
  // splitLineToFitWidth (mermaid rendering-util/splitText.ts): thrown when a
  // markdown list expands into embedded newlines in a label wide enough to wrap.
  'does not support newlines',
];

export function normalizeError(err: unknown): ApiError {
  // UnknownDiagramError
  if (err instanceof Error && err.name === 'UnknownDiagramError') {
    return {
      code: 'UNKNOWN_DIAGRAM_TYPE',
      message: err.message,
      statusCode: 422,
    };
  }

  // Jison DetailedError (has .hash with parse details)
  if (isDetailedError(err)) {
    const hash = err.hash;
    return {
      code: 'PARSE_ERROR',
      message: err.message ?? err.str ?? 'Parse error',
      statusCode: 422,
      details: {
        line: hash?.line ?? hash?.loc?.first_line,
        column: hash?.loc?.first_column,
        token: hash?.token,
        expected: hash?.expected,
      },
    };
  }

  // Standard Error with parse-related message
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('parse') || msg.includes('expecting') || msg.includes('unexpected')) {
      return {
        code: 'PARSE_ERROR',
        message: err.message,
        statusCode: 422,
      };
    }
    if (KNOWN_RENDER_INPUT_ERRORS.some((pattern) => msg.includes(pattern))) {
      return {
        code: 'RENDER_ERROR',
        message: err.message,
        statusCode: 422,
      };
    }
    return {
      code: 'INTERNAL_ERROR',
      message: err.message,
      statusCode: 500,
    };
  }

  // Non-Error thrown values
  return {
    code: 'INTERNAL_ERROR',
    message: String(err),
    statusCode: 500,
  };
}
