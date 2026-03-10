import type { CIGBuildResult } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntryPoint {
  /** File path of the detected entry point. */
  filePath: string;
  /** Numeric score (higher = stronger entry-point signal). */
  score: number;
  /** Reasons this file was flagged as an entry point. */
  reasons: EntryPointReason[];
}

export type EntryPointReason =
  | 'high-fan-in'       // fan-in >= minFanIn
  | 'low-fan-out'       // fan-out <= maxFanOut AND fan-in > 0
  | 'filename-match'    // basename matches a known entry-point name
  | 'zero-importers';   // fan-in === 0 AND fan-out > 0 (leaf consumer: CLI, server main)

export interface EntryPointDetectorConfig {
  /**
   * Minimum fan-in (number of files that import this file) to qualify
   * as a high-fan-in entry point. Default: 3.
   */
  minFanIn?: number;

  /**
   * Maximum fan-out (number of files this file imports) for a file to
   * qualify as low-fan-out. Default: 2.
   */
  maxFanOut?: number;

  /**
   * Additional filenames (without extension) to treat as entry-point
   * indicators, merged with the built-in list.
   */
  extraEntryPointNames?: string[];
}

// ---------------------------------------------------------------------------
// Built-in entry-point filename patterns
// ---------------------------------------------------------------------------

const DEFAULT_ENTRY_POINT_NAMES = new Set([
  'index',
  'main',
  'app',
  'server',
  'cli',
  'bin',
  'entry',
  'bootstrap',
  'startup',
]);

// ---------------------------------------------------------------------------
// EntryPointDetector
// ---------------------------------------------------------------------------

export class EntryPointDetector {
  private readonly minFanIn: number;
  private readonly maxFanOut: number;
  private readonly entryPointNames: Set<string>;

  constructor(config?: EntryPointDetectorConfig) {
    this.minFanIn = config?.minFanIn ?? 3;
    this.maxFanOut = config?.maxFanOut ?? 2;

    this.entryPointNames = new Set(DEFAULT_ENTRY_POINT_NAMES);
    if (config?.extraEntryPointNames) {
      for (const name of config.extraEntryPointNames) {
        this.entryPointNames.add(name.toLowerCase());
      }
    }
  }

  /**
   * Analyse a CIG build result and return detected entry points,
   * sorted by score descending.
   */
  detect(result: CIGBuildResult): EntryPoint[] {
    // Compute per-file fan-in and fan-out from import edges.
    const fanIn = new Map<string, Set<string>>(); // filePath → set of importing files
    const fanOut = new Map<string, Set<string>>(); // filePath → set of imported files

    // Collect all files that have a <module> node (i.e. were processed by CIG).
    const processedFiles = new Set<string>();
    for (const node of result.nodes) {
      if (node.symbolName === '<module>') {
        processedFiles.add(node.filePath);
      }
    }

    // Initialise maps for every processed file.
    for (const fp of processedFiles) {
      fanIn.set(fp, new Set());
      fanOut.set(fp, new Set());
    }

    // Walk import edges to populate fan-in / fan-out.
    for (const edge of result.edges) {
      if (edge.edgeType !== 'imports') continue;

      const fromFile = this.filePathFromNodeId(edge.fromNodeId);
      const toFile = this.filePathFromNodeId(edge.toNodeId);

      if (!fromFile || !toFile || fromFile === toFile) continue;

      // fromFile imports something from toFile
      fanOut.get(fromFile)?.add(toFile);
      fanIn.get(toFile)?.add(fromFile);
    }

    // Score each file.
    const entryPointMap = new Map<string, EntryPoint>();

    for (const fp of processedFiles) {
      const inCount = fanIn.get(fp)?.size ?? 0;
      const outCount = fanOut.get(fp)?.size ?? 0;
      const reasons: EntryPointReason[] = [];
      let score = 0;

      // High fan-in: many other files import this file.
      if (inCount >= this.minFanIn) {
        reasons.push('high-fan-in');
        score += inCount; // more importers = higher score
      }

      // Low fan-out: this file imports few other files.
      if (outCount <= this.maxFanOut && inCount > 0) {
        reasons.push('low-fan-out');
        score += 1;
      }

      // Zero importers (leaf entry — e.g. a CLI script or server main).
      if (inCount === 0 && outCount > 0) {
        reasons.push('zero-importers');
        score += 2;
      }

      // Filename match.
      if (this.isEntryPointFilename(fp)) {
        reasons.push('filename-match');
        score += 2;
      }

      if (reasons.length > 0) {
        entryPointMap.set(fp, { filePath: fp, score, reasons });
      }
    }

    // Sort by score descending, then filePath ascending for stability.
    return Array.from(entryPointMap.values()).sort(
      (a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath),
    );
  }

  /**
   * Enrich the CIG build result by adding `isEntryPoint` and
   * `entryPointScore` to the metadata of `<module>` nodes that
   * were detected as entry points.  Mutates nodes in-place and
   * returns the entry point list.
   */
  detectAndEnrich(result: CIGBuildResult): EntryPoint[] {
    const entryPoints = this.detect(result);
    const epByFile = new Map(entryPoints.map(ep => [ep.filePath, ep]));

    for (const node of result.nodes) {
      if (node.symbolName !== '<module>') continue;
      const ep = epByFile.get(node.filePath);
      if (ep) {
        node.metadata = {
          ...(node.metadata ?? {}),
          isEntryPoint: true,
          entryPointScore: ep.score,
          entryPointReasons: ep.reasons,
        };
      }
    }

    return entryPoints;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Extract the filePath segment from a nodeId.
   * nodeId format: `repoId:filePath:symbolName:symbolType`
   *
   * We split on `:` and take everything between the first and
   * the third-from-last colon to handle file paths that might
   * contain colons (unlikely but defensive).
   */
  private filePathFromNodeId(nodeId: string): string | null {
    // Format: repoId:filePath:symbolName:symbolType
    // repoId itself should not contain `:`.
    const firstColon = nodeId.indexOf(':');
    if (firstColon === -1) return null;

    // symbolType is last segment, symbolName is second-to-last.
    const lastColon = nodeId.lastIndexOf(':');
    if (lastColon === firstColon) return null;

    const secondLastColon = nodeId.lastIndexOf(':', lastColon - 1);
    if (secondLastColon === -1 || secondLastColon <= firstColon) return null;

    const filePath = nodeId.substring(firstColon + 1, secondLastColon);
    return filePath.length > 0 ? filePath : null;
  }

  /** Check if a file's basename (without extension) matches entry-point names. */
  private isEntryPointFilename(filePath: string): boolean {
    // Extract basename without extension.
    const lastSlash = filePath.lastIndexOf('/');
    const basename = lastSlash === -1 ? filePath : filePath.substring(lastSlash + 1);
    const dotIdx = basename.lastIndexOf('.');
    const nameWithoutExt = dotIdx === -1 ? basename : basename.substring(0, dotIdx);

    return this.entryPointNames.has(nameWithoutExt.toLowerCase());
  }
}
