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
