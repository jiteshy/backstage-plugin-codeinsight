import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { extractMermaid } from '../../utils';

/**
 * StateFlowModule — LLM-assisted.
 *
 * Input: store/reducer definitions from CIG (nodes in state management files).
 * Output: `stateDiagram-v2` showing state transitions.
 * Triggered on Redux, Zustand, MobX, Pinia, Recoil/Jotai signals.
 */
export class StateFlowModule implements DiagramModule {
  readonly id = 'frontend/state-flow';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'state-management:redux',
    'state-management:zustand',
    'state-management:mobx',
    'state-management:pinia',
    'state-management:recoil',
    'state-management:jotai',
    'state-management:vuex',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    // Find store/reducer/slice definitions
    const storeKeywords = ['store', 'reducer', 'slice', 'atom', 'state', 'action', 'mutation'];
    const storeNodes = cig.nodes.filter(
      n =>
        (n.symbolType === 'function' || n.symbolType === 'variable' || n.symbolType === 'class') &&
        storeKeywords.some(kw => n.symbolName.toLowerCase().includes(kw)),
    );

    if (storeNodes.length === 0) return null;

    const nodeList = storeNodes
      .slice(0, 25)
      .map(n => `- ${n.symbolName} (${n.symbolType}, ${n.filePath})`)
      .join('\n');

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid stateDiagram-v2 syntax. No explanation, no fences, no markdown.
Keep state labels short (≤ 20 chars).`;

    const userPrompt = `Generate a Mermaid stateDiagram-v2 for the frontend state management.
Show key application states and transitions between them.

State management symbols detected:
${nodeList}

Infer the most important states and transitions from these names.
Output only the Mermaid stateDiagram-v2 block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 1000,
      temperature: 0.2,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    return {
      diagramType: 'stateDiagram',
      mermaid,
      title: 'State Flow',
      description: 'Application state transitions inferred from store definitions',
      llmUsed: true,
    };
  }
}
