import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { buildFileSummaryBlock, extractMermaid } from '../../utils';

/**
 * HighLevelArchitectureModule — LLM-assisted, always-on.
 *
 * Produces a C4-style system overview: detects architectural layers
 * (api/, services/, models/, components/), external dependencies
 * (axios, prisma, redis, postgres, kafka, s3, etc.), and route counts.
 *
 * The LLM synthesizes a `flowchart TD` with subgraphs representing each
 * detected layer. Self-terminates if fewer than 10 source files are found
 * (too small to make a useful architectural overview).
 */
export class HighLevelArchitectureModule implements DiagramModule {
  readonly id = 'universal/high-level-architecture';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn: readonly string[] = [];
  readonly llmNeeded = true;

  private static readonly MIN_FILES = 10;

  private static readonly EXTERNAL_DEPS: Array<[RegExp, string]> = [
    [/\baxios\b|\bfetch\b|\bgot\b|\bnode-fetch\b/, 'HTTP Client'],
    [/\bprisma\b/, 'Prisma ORM'],
    [/\bsequelize\b|\btypeorm\b|\bknex\b|\bdrizzle\b/, 'SQL ORM'],
    [/\bmongoose\b|\bmongodb\b/, 'MongoDB'],
    [/\bredis\b|\bioredis\b/, 'Redis'],
    [/\bkafka\b|\bkafkajs\b/, 'Kafka'],
    [/\bpostgresql\b|\bpg\b|\bpostgres\b/, 'PostgreSQL'],
    [/\bs3\b|\baws-sdk\b|\b@aws-sdk\b/, 'AWS S3'],
    [/\belasticsearch\b|\b@elastic\b/, 'Elasticsearch'],
    [/\brabbitmq\b|\bamqplib\b/, 'RabbitMQ'],
    [/\bstripe\b/, 'Stripe'],
    [/\bsendgrid\b|\bnodemailer\b/, 'Email'],
    [/\btwilio\b/, 'Twilio'],
    [/\bsupabase\b/, 'Supabase'],
    [/\bfirebase\b/, 'Firebase'],
  ];

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    // Only run for repos with enough source files
    const sourceFiles = new Set(cig.nodes.map(n => n.filePath));
    if (sourceFiles.size < HighLevelArchitectureModule.MIN_FILES) return null;

    // Detect architectural layers from file paths
    const layers = this.detectLayers(Array.from(sourceFiles));

    // Detect external dependencies from import edges (toNodeId symbol names and paths)
    const externalDeps = this.detectExternalDeps(cig);

    // Count routes
    const routeCount = cig.nodes.filter(n => n.symbolType === 'route').length;

    // Summarize for LLM
    const layerLines = Object.entries(layers)
      .filter(([, files]) => files.length > 0)
      .map(([layer, files]) => `  ${layer}: ${files.length} file(s) (e.g. ${files.slice(0, 3).join(', ')})`);

    const depLines = externalDeps.length > 0
      ? `External dependencies detected: ${externalDeps.join(', ')}`
      : 'No well-known external dependencies detected';

    const routeLine = routeCount > 0
      ? `API routes: ${routeCount} route handler(s) detected`
      : '';

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid flowchart TD syntax with subgraphs. No explanation, no fences, no markdown.
Keep node labels ≤ 25 characters. Use subgraph blocks for architectural layers.
Emit at most 20 nodes total. Use short IDs (A, B, API, SVC, DB, etc.).`;

    const summaryBlock = buildFileSummaryBlock(cig);

    const userPrompt = `Generate a Mermaid flowchart TD showing the high-level architecture of this codebase.
${summaryBlock ? `\n## Key File Summaries (most-imported source files)\n${summaryBlock}\n\nUse these summaries to understand what each layer does and how they interact.\n` : ''}
Use subgraphs for each detected architectural layer. Show data flow from client/API through layers to data stores.
Show external integrations as leaf nodes.

Detected architectural layers:
${layerLines.length > 0 ? layerLines.join('\n') : '  (no standard layers detected — use file structure)'}

${depLines}
${routeLine}

Total source files: ${sourceFiles.size}

Guidelines:
- Create a subgraph for each layer with 1-3 representative nodes
- Show arrows for the primary data flow direction
- Add external dependencies as terminal nodes
- Do NOT include file paths — use conceptual labels

Output only the Mermaid flowchart TD block (starting with "flowchart TD").`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 1000,
      temperature: 0.15,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    return {
      diagramType: 'flowchart',
      mermaid,
      title: 'High-Level Architecture',
      description: 'C4-style system overview showing architectural layers and external integrations',
      llmUsed: true,
      // nodeMap omitted — LLM generates conceptual subgraph labels that don't map 1:1 to file paths.
    };
  }

  /**
   * Detect standard architectural layers from file paths.
   * Returns a map of layer name → array of representative file names.
   */
  private detectLayers(filePaths: string[]): Record<string, string[]> {
    const layers: Record<string, string[]> = {
      'API / Routes': [],
      'Services / Business Logic': [],
      'Models / Entities': [],
      'Components / UI': [],
      'Middleware': [],
      'Config / Infra': [],
    };

    for (const fp of filePaths) {
      const lower = fp.toLowerCase();
      const fileName = fp.split('/').pop() ?? fp;

      if (/\/routes?\/|\/controllers?\/|\/handlers?\/|\/api\//.test(lower)) {
        layers['API / Routes'].push(fileName);
      } else if (/\/services?\/|\/business\/|\/domain\/|\/use-cases?\//.test(lower)) {
        layers['Services / Business Logic'].push(fileName);
      } else if (/\/models?\/|\/entities\/|\/schemas?\/|\/dto\/|\.prisma$/.test(lower)) {
        layers['Models / Entities'].push(fileName);
      } else if (/\/components?\/|\/pages?\/|\/views?\/|\/screens?\//.test(lower)) {
        layers['Components / UI'].push(fileName);
      } else if (/\/middlewares?\/|\/interceptors?\/|\/guards?\//.test(lower)) {
        layers['Middleware'].push(fileName);
      } else if (/\/config\/|\/infrastructure\/|\/infra\/|\/setup\//.test(lower)) {
        layers['Config / Infra'].push(fileName);
      }
    }

    return layers;
  }

  /**
   * Detect external dependencies by scanning node symbol names and file paths
   * for well-known library identifiers.
   */
  private detectExternalDeps(cig: CIGSnapshot): string[] {
    const allText = [
      ...cig.nodes.map(n => n.symbolName),
      ...cig.nodes.map(n => n.filePath),
    ].join(' ').toLowerCase();

    const detected: string[] = [];
    const seen = new Set<string>();

    for (const [pattern, label] of HighLevelArchitectureModule.EXTERNAL_DEPS) {
      if (pattern.test(allText) && !seen.has(label)) {
        detected.push(label);
        seen.add(label);
      }
    }

    return detected;
  }
}
