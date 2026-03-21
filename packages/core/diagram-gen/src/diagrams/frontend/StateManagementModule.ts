import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { extractMermaid } from '../../utils';

/**
 * StateManagementModule — Hybrid (AST + optional LLM).
 *
 * Signal-gated: triggers on any state-management signal detected by SignalDetector
 * (state-management:redux, state-management:zustand, state-management:context,
 * state-management:mobx).
 *
 * AST phase: detects store/context/reducer nodes by symbol name + file path
 * heuristics. Traces import edges from component nodes to state nodes.
 *
 * LLM phase (optional): if an LLM is available, it refines node labels and adds
 * a description of the state topology. Without LLM, produces a clean AST-only diagram.
 *
 * `graph TD` layout shows Components → State → Store hierarchy top-down.
 */
type StateItem = { node: { nodeId: string; symbolName: string; filePath: string }; category: string };

export class StateManagementModule implements DiagramModule {
  readonly id = 'frontend/state-management';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'state-management:redux',
    'state-management:zustand',
    'state-management:context',
    'state-management:mobx',
  ] as const;
  readonly llmNeeded = false; // Can run without LLM (AST-only mode)

  private static readonly MAX_NODES = 40;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    // ── AST phase: identify state nodes ────────────────────────────────────
    const stateNodes = cig.nodes.filter(n => this.isStateNode(n.symbolName, n.filePath));
    if (stateNodes.length === 0) return null;

    // Build a file → node lookup for import tracing
    const nodeById = new Map(cig.nodes.map(n => [n.nodeId, n]));
    const stateFilePaths = new Set(stateNodes.map(n => n.filePath));

    // Collect component → state edges (file level)
    const componentToState = new Set<string>(); // "componentFile|||stateFile"
    for (const edge of cig.edges) {
      if (edge.edgeType !== 'imports') continue;
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) continue;
      if (!stateFilePaths.has(to.filePath)) continue;
      if (stateFilePaths.has(from.filePath)) continue; // state→state edges skipped

      componentToState.add(`${from.filePath}|||${to.filePath}`);
    }

    // Build node map (mermaid node ID → file path)
    const nodeMap: Record<string, string> = {};

    // Assign categories to state nodes
    const categorized: StateItem[] = stateNodes.slice(0, StateManagementModule.MAX_NODES).map(n => ({
      node: n,
      category: this.categorizeState(n.symbolName, n.filePath),
    }));

    // Generate Mermaid — if LLM is available, use it to synthesize labels
    if (llmClient && categorized.length > 0) {
      return this.generateWithLLM(cig, categorized, componentToState, nodeMap, llmClient);
    }

    return this.generateAST(categorized, componentToState, nodeMap);
  }

  private generateAST(
    categorized: Array<{ node: { nodeId: string; symbolName: string; filePath: string }; category: string }>,
    componentToState: Set<string>,
    nodeMap: Record<string, string>,
  ): MermaidDiagram | null {
    const lines: string[] = ['graph TD'];

    // Emit state nodes grouped by category
    const byCategory = new Map<string, typeof categorized>();
    for (const item of categorized) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }

    // Emit subgraph-like groups using labeled nodes
    for (const [category, items] of byCategory) {
      for (const { node } of items) {
        const nid = this.nodeId(node.filePath + ':' + node.symbolName);
        const label = this.shortLabel(node.symbolName);
        lines.push(`  ${nid}["${category}: ${label}"]`);
        nodeMap[nid] = node.filePath;
      }
    }

    // Emit component→state edges (collapsed to unique file pairs)
    let edgeCount = 0;
    const emitted = new Set<string>();
    for (const key of componentToState) {
      if (edgeCount >= 20) break;
      const [compFile, stateFile] = key.split('|||');
      const compNid = this.nodeId(compFile);
      const stateNids = Array.from(byCategory.values())
        .flat()
        .filter(item => item.node.filePath === stateFile)
        .map(item => this.nodeId(stateFile + ':' + item.node.symbolName));

      for (const stateNid of stateNids.slice(0, 1)) {
        const edgeKey = `${compNid}|||${stateNid}`;
        if (emitted.has(edgeKey)) continue;
        emitted.add(edgeKey);
        const compLabel = this.shortName(compFile);
        lines.push(`  ${compNid}["${compLabel}"] --> ${stateNid}`);
        nodeMap[compNid] = compFile;
        edgeCount++;
      }
    }

    if (lines.length <= 1) return null;

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'State Management',
      description: `${categorized.length} state node(s) detected — shows component-to-store connections`,
      llmUsed: false,
      nodeMap,
    };
  }

  private async generateWithLLM(
    _cig: CIGSnapshot,
    categorized: Array<{ node: { nodeId: string; symbolName: string; filePath: string }; category: string }>,
    componentToState: Set<string>,
    nodeMap: Record<string, string>,
    llmClient: LLMClient,
  ): Promise<MermaidDiagram | null> {
    const storeList = categorized
      .slice(0, 20)
      .map(({ node, category }) => `  ${category}: ${node.symbolName} (${node.filePath})`)
      .join('\n');

    const compConnections = Array.from(componentToState)
      .slice(0, 15)
      .map(key => {
        const [comp, state] = key.split('|||');
        return `  ${this.shortName(comp)} → ${this.shortName(state)}`;
      })
      .join('\n');

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid graph TD syntax. No explanation, no fences, no markdown.
Use short node IDs (STORE1, CTX1, COMP1, etc.). Keep labels ≤ 20 chars.
Emit at most 20 nodes and 20 edges.`;

    const userPrompt = `Generate a Mermaid graph TD showing the state management architecture.

State nodes detected:
${storeList}

Component-to-state connections:
${compConnections || '  (none detected)'}

Guidelines:
- Group stores/contexts at the top
- Show components that use them below
- Use descriptive but short labels
- Add style for store nodes: style STORE1 fill:#e8f4f8

Output only the Mermaid graph TD block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 900,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) {
      // Fallback to AST-only
      return this.generateAST(categorized, componentToState, nodeMap);
    }

    // Build nodeMap from detected state nodes (best-effort — LLM IDs are unpredictable)
    for (const { node } of categorized) {
      nodeMap[this.nodeId(node.filePath + ':' + node.symbolName)] = node.filePath;
    }

    return {
      diagramType: 'graph',
      mermaid,
      title: 'State Management',
      description: `${categorized.length} state node(s) — component-to-store dependency map`,
      llmUsed: true,
      nodeMap,
    };
  }

  /** True if the node represents a state store/context/reducer. */
  private isStateNode(symbolName: string, filePath: string): boolean {
    const name = symbolName.toLowerCase();
    const path = filePath.toLowerCase();

    return (
      // Redux patterns
      /reducer|createslice|configurestore|redux/.test(name) ||
      // Zustand
      /\bcreate\b.*store|usestore|zustand/.test(name) ||
      // React Context
      /createcontext|contextprovider|usecontext/.test(name) ||
      // MobX
      /makeobservable|makeautoobservable|\bobservable\b/.test(name) ||
      // File path heuristics
      /\/(store|stores|state|redux|contexts?|reducers?|slices?|atoms?)\//.test(path) ||
      /store\.(ts|tsx|js|jsx)$/.test(path) ||
      /context\.(ts|tsx|js|jsx)$/.test(path)
    );
  }

  private categorizeState(symbolName: string, filePath: string): string {
    const name = symbolName.toLowerCase();
    const path = filePath.toLowerCase();

    if (/reducer|createslice|configurestore|\/redux\/|\/reducers?\/|\/slices?\//.test(name + path)) {
      return 'Redux';
    }
    if (/zustand|create.*store|usestore/.test(name + path)) {
      return 'Zustand';
    }
    if (/createcontext|contextprovider|usecontext|\/contexts?\//.test(name + path)) {
      return 'Context';
    }
    if (/makeobservable|makeautoobservable|observable|mobx/.test(name + path)) {
      return 'MobX';
    }
    return 'State';
  }

  private nodeId(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private shortName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, '');
  }

  private shortLabel(symbolName: string): string {
    return symbolName.length > 22 ? symbolName.slice(0, 20) + '..' : symbolName;
  }
}
