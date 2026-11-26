/** Provider-independent contract: swap the implementation without touching the assistant. */
export interface Statement {
  text: string;
  kind: 'fact' | 'calculation' | 'assumption' | 'interpretation';
  citations: string[];
}

export interface ModelAnswer {
  statements: Statement[];
  insufficient: boolean;
}

export interface LlmProvider {
  name: string;
  model: string;
  answer(request: { system: string; user: string }): Promise<ModelAnswer>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'refused' | 'truncated' | 'invalid_output' | 'rate_limited' | 'unavailable',
  ) {
    super(message);
  }
}
