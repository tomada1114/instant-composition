import { z } from "zod";

// The parts of an OpenRouter chat completion the adapter reads. Anything else
// in the answer is ignored, so a field OpenRouter adds breaks nothing.

const completion = z.object({
  choices: z.tuple(
    [z.object({ message: z.object({ content: z.string() }) })],
    z.unknown(),
  ),
});

const count = z.number().int().nonnegative().catch(0);

const usage = z
  .object({
    usage: z
      .object({
        prompt_tokens: count,
        completion_tokens: count,
        cost: z.number().nonnegative().nullable().catch(null),
      })
      .catch({ prompt_tokens: 0, completion_tokens: 0, cost: null }),
  })
  .catch({ usage: { prompt_tokens: 0, completion_tokens: 0, cost: null } });

/** What the completion's usage reported; a count it left out is 0, a cost it left out `null`. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

/** The first choice's message content, or `undefined` when the body is not a completion. */
export function contentOf(body: unknown): string | undefined {
  const parsed = completion.safeParse(body);
  return parsed.success ? parsed.data.choices[0].message.content : undefined;
}

export function usageOf(body: unknown): Usage {
  const reported = usage.parse(body).usage;
  return {
    inputTokens: reported.prompt_tokens,
    outputTokens: reported.completion_tokens,
    costUsd: reported.cost,
  };
}

/** The content parsed as JSON, or `undefined` when it is not JSON at all. */
export function parsedContent(
  content: string,
): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(content) as unknown };
  } catch {
    return undefined;
  }
}
