import type { LLMClient } from '@codeinsight/types';

import type { FactScore } from '../types';

const SYSTEM_PROMPT = `You are a strict grader for a documentation evaluation pipeline.
You receive (a) a piece of generated documentation and (b) a list of facts the documentation is expected to convey.
For each fact, judge whether it is clearly present (score 1), partially/implicitly present (score 0.5), or absent/wrong (score 0).
Return JSON ONLY, matching this shape exactly:
{"results": [{"fact": string, "score": 0|0.5|1, "reason": string (<=120 chars)}, ...]}
Return the same facts in the same order. Do not return markdown or prose.`;

export async function judgeFactPresence(
  llm: LLMClient,
  generatedText: string,
  facts: string[],
): Promise<FactScore[]> {
  const userPrompt =
    `Documentation to evaluate:\n---\n${generatedText}\n---\n\nFacts (in order):\n` +
    facts.map((f, i) => `${i + 1}. ${f}`).join('\n') +
    `\n\nReturn JSON only.`;

  const raw = await llm.complete(SYSTEM_PROMPT, userPrompt, {
    maxTokens: 1500,
    temperature: 0,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`judgeFactPresence: LLM returned invalid JSON: ${String(err)}`);
  }

  const results = (parsed as { results?: FactScore[] }).results;
  if (!Array.isArray(results)) {
    throw new Error('judgeFactPresence: response missing "results" array');
  }
  if (results.length !== facts.length) {
    throw new Error(
      `judgeFactPresence: results length ${results.length} mismatches facts length ${facts.length}`,
    );
  }

  return results.map((r, i) => {
    const score = r.score === 1 || r.score === 0.5 || r.score === 0 ? r.score : null;
    if (score === null) {
      throw new Error(`judgeFactPresence: result ${i} has invalid score ${String(r.score)}`);
    }
    return {
      fact: facts[i],
      score,
      reason: typeof r.reason === 'string' ? r.reason : '',
    };
  });
}
