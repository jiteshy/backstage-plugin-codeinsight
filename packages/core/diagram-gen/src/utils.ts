import type { CIGSnapshot } from './types';

/**
 * Build a compact "Key File Summaries" text block for LLM diagram prompts.
 *
 * Selects the top N source files by import in-degree from the CIG and looks
 * up their summaries. Returns null if no summaries are available.
 *
 * @param cig       CIG snapshot (uses cig.fileSummaries)
 * @param maxFiles  Max number of file summaries to include (default: 20)
 * @param maxChars  Hard cap on total block length in chars (default: 4000)
 */
export function buildFileSummaryBlock(
  cig: CIGSnapshot,
  maxFiles = 20,
  maxChars = 4000,
): string | null {
  if (!cig.fileSummaries || cig.fileSummaries.size === 0) return null;

  // Build file-level in-degree from import edges
  const nodeToFile = new Map<string, string>();
  for (const n of cig.nodes) {
    nodeToFile.set(n.nodeId, n.filePath);
  }

  const inDegree = new Map<string, number>();
  for (const edge of cig.edges) {
    if (edge.edgeType !== 'imports') continue;
    const toFile = nodeToFile.get(edge.toNodeId);
    if (!toFile) continue;
    inDegree.set(toFile, (inDegree.get(toFile) ?? 0) + 1);
  }

  // Sort by in-degree, take top N that have summaries
  const ranked = [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fp]) => fp)
    .filter(fp => cig.fileSummaries!.has(fp))
    .slice(0, maxFiles);

  if (ranked.length === 0) return null;

  const lines: string[] = [];
  let totalChars = 0;
  for (const fp of ranked) {
    const summary = cig.fileSummaries!.get(fp)!;
    const line = `${fp}: ${summary}`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length + 1;
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract clean Mermaid DSL from an LLM response.
 *
 * Handles both raw Mermaid output and output wrapped in fenced code blocks:
 *   ```mermaid
 *   ...
 *   ```
 * Returns null if the output appears empty or invalid.
 */
export function extractMermaid(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:mermaid)?\s*\n([\s\S]+?)\n```\s*$/);
  const content = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Must start with a known Mermaid diagram keyword
  const validStarters = [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'erDiagram',
    'stateDiagram',
    'classDiagram',
    'gantt',
    'pie',
    'gitGraph',
    'mindmap',
    'timeline',
  ];

  const firstToken = content.split(/\s/)[0];
  if (!validStarters.some(s => firstToken.startsWith(s))) {
    return null;
  }

  return content;
}
