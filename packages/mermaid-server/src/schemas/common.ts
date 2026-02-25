export const diagramInput = {
  type: 'object' as const,
  required: ['diagram'] as const,
  properties: {
    diagram: {
      type: 'string' as const,
      maxLength: 50000,
      description: 'Mermaid diagram definition text',
    },
    config: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Optional MermaidConfig overrides',
    },
  },
};

export const errorResponse = {
  type: 'object' as const,
  properties: {
    error: {
      type: 'object' as const,
      properties: {
        code: { type: 'string' as const },
        message: { type: 'string' as const },
        details: { type: 'object' as const, additionalProperties: true },
      },
    },
  },
};
