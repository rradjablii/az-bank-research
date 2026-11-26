import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ProviderError, type LlmProvider } from './provider.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

const answerSchema = z.object({
  statements: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['fact', 'calculation', 'assumption', 'interpretation']),
      citations: z.array(z.string()),
    }),
  ),
  insufficient: z.boolean(),
});

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['statements', 'insufficient'],
  properties: {
    statements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'kind', 'citations'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['fact', 'calculation', 'assumption', 'interpretation'] },
          citations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    insufficient: { type: 'boolean' },
  },
};

export function anthropicProvider(model = process.env.AI_MODEL || DEFAULT_MODEL, client = new Anthropic({ timeout: 60_000, maxRetries: 1 })): LlmProvider {
  return {
    name: 'anthropic',
    model,
    async answer({ system, user }) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA } },
          // Server-side fallback: if a safety classifier declines, the API retries on a fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
        if (response.stop_reason === 'refusal') throw new ProviderError('The model declined this question', 'refused');
        if (response.stop_reason === 'max_tokens') throw new ProviderError('The answer was cut off', 'truncated');
        const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        const parsed = answerSchema.safeParse(JSON.parse(text));
        if (!parsed.success) throw new ProviderError('The model returned an unexpected format', 'invalid_output');
        return parsed.data;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof SyntaxError) throw new ProviderError('The model returned invalid JSON', 'invalid_output');
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('The AI provider is rate limiting requests', 'rate_limited');
        // Log the class and status only; never the request or credentials.
        console.error('ai.provider', e instanceof Anthropic.APIError ? `status ${e.status}` : (e as Error).name);
        throw new ProviderError('The AI provider is unavailable', 'unavailable');
      }
    },
  };
}
