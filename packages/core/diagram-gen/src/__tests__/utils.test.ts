import { extractMermaid } from '../utils';

describe('extractMermaid()', () => {
  // -------------------------------------------------------------------------
  // Happy path — plain Mermaid (no fences)
  // -------------------------------------------------------------------------

  it('returns plain graph TD content as-is', () => {
    const input = 'graph TD\n  A --> B';
    expect(extractMermaid(input)).toBe(input);
  });

  it('returns plain erDiagram content as-is', () => {
    const input = 'erDiagram\n  User ||--o{ Post : "has"';
    expect(extractMermaid(input)).toBe(input);
  });

  it('returns plain sequenceDiagram content as-is', () => {
    const input = 'sequenceDiagram\n  Alice->>Bob: Hello';
    expect(extractMermaid(input)).toBe(input);
  });

  it('handles all valid Mermaid starters', () => {
    const starters = [
      'graph TD\n  A --> B',
      'flowchart LR\n  X --> Y',
      'sequenceDiagram\n  A->>B: msg',
      'erDiagram\n  T { string id }',
      'stateDiagram\n  [*] --> s1',
      'classDiagram\n  class Foo',
      'gantt\n  title Project',
      'pie\n  title Slices',
      'gitGraph\n  commit',
      'mindmap\n  root',
      'timeline\n  section A',
    ];
    for (const input of starters) {
      expect(extractMermaid(input)).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Fenced code blocks
  // -------------------------------------------------------------------------

  it('strips ```mermaid fenced block and returns inner content', () => {
    const inner = 'graph TD\n  A --> B';
    const fenced = '```mermaid\n' + inner + '\n```';
    expect(extractMermaid(fenced)).toBe(inner);
  });

  it('strips plain ``` fenced block (no language label) and returns inner content', () => {
    const inner = 'graph TD\n  X --> Y';
    const fenced = '```\n' + inner + '\n```';
    expect(extractMermaid(fenced)).toBe(inner);
  });

  it('trims surrounding whitespace before processing fences', () => {
    const inner = 'erDiagram\n  User { string id }';
    const input = '  \n```mermaid\n' + inner + '\n```\n  ';
    expect(extractMermaid(input)).toBe(inner);
  });

  // -------------------------------------------------------------------------
  // Invalid / null cases
  // -------------------------------------------------------------------------

  it('returns null for an empty string', () => {
    expect(extractMermaid('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(extractMermaid('   \n\t  ')).toBeNull();
  });

  it('returns null when content does not start with a known Mermaid keyword', () => {
    expect(extractMermaid('This is plain text, not a diagram.')).toBeNull();
  });

  it('returns null for a fenced block whose inner content has an invalid start', () => {
    const fenced = '```mermaid\nHello world\n```';
    expect(extractMermaid(fenced)).toBeNull();
  });

  it('returns null for JSON-looking content', () => {
    expect(extractMermaid('{ "type": "diagram" }')).toBeNull();
  });

  it('returns null for markdown-looking text without a valid diagram keyword', () => {
    expect(extractMermaid('## Overview\n\nSome text here')).toBeNull();
  });
});
