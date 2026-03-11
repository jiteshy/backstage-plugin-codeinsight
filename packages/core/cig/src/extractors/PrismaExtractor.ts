import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';

import type { ContentExtractor } from '../types';

// ---------------------------------------------------------------------------
// Prisma schema block types
// ---------------------------------------------------------------------------

type PrismaBlockType = 'model' | 'enum' | 'type';

interface PrismaField {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  relationName: string | null;
  relationFields: string[];
  relationReferences: string[];
}

interface PrismaBlock {
  blockType: PrismaBlockType;
  name: string;
  startLine: number;
  endLine: number;
  fields: PrismaField[];
}

// ---------------------------------------------------------------------------
// PrismaExtractor — regex-based extraction for .prisma schema files
// ---------------------------------------------------------------------------

// Matches: model Foo {, enum Bar {, type Baz {
const BLOCK_OPEN_RE = /^(model|enum|type)\s+(\w+)\s*\{/;

// Field line: name Type modifiers @attributes
const FIELD_RE = /^\s+(\w+)\s+(\w+)(\[\])?\s*(\?)?\s*(.*)?$/;

// @id attribute
const ID_ATTR_RE = /@id\b/;
// @unique attribute
const UNIQUE_ATTR_RE = /@unique\b/;
// @default(...) attribute
const DEFAULT_ATTR_RE = /@default\b/;
// @relation(...) attribute with fields/references
const RELATION_RE = /@relation\(([^)]*)\)/;
// Relation name: positional first arg (quoted string at start) OR explicit name: "..."
const RELATION_NAME_RE = /(?:^\s*|name:\s*)["']([^"']+)["']/;
// fields: [...]
const RELATION_FIELDS_RE = /fields:\s*\[([^\]]+)\]/;
// references: [...]
const RELATION_REFS_RE = /references:\s*\[([^\]]+)\]/;

export class PrismaExtractor implements ContentExtractor {
  readonly languages = ['prisma'];

  // -------------------------------------------------------------------------
  // Symbol extraction
  // -------------------------------------------------------------------------

  extractSymbols(content: string, file: RepoFile, repoId: string): CIGNode[] {
    const blocks = this.parseBlocks(content);
    return blocks.map(block => this.blockToNode(block, file, repoId));
  }

  // -------------------------------------------------------------------------
  // Edge extraction — relation fields create edges between models
  // -------------------------------------------------------------------------

  extractEdges(
    content: string,
    file: RepoFile,
    repoId: string,
    nodesByFile: Map<string, CIGNode[]>,
  ): CIGEdge[] {
    const blocks = this.parseBlocks(content);
    const edges: CIGEdge[] = [];

    // Build a map of model names → node IDs across all files
    const modelNodeMap = new Map<string, string>();
    for (const [, nodes] of nodesByFile) {
      for (const node of nodes) {
        if (node.symbolType === 'schema') {
          modelNodeMap.set(node.symbolName, node.nodeId);
        }
      }
    }

    for (const block of blocks) {
      if (block.blockType !== 'model' && block.blockType !== 'type') continue;

      const fromNodeId = `${repoId}:${file.filePath}:${block.name}:schema`;

      for (const field of block.fields) {
        // A field whose type matches another model name = relation
        const targetNodeId = modelNodeMap.get(field.type);
        if (!targetNodeId) continue;
        // Skip self-references that aren't actual relations
        if (targetNodeId === fromNodeId && !field.relationName) continue;

        const edgeId = `${fromNodeId}:${field.name}->references->${targetNodeId}`;
        edges.push({
          edgeId,
          repoId,
          fromNodeId,
          toNodeId: targetNodeId,
          edgeType: 'references',
        });
      }
    }

    return edges;
  }

  // -------------------------------------------------------------------------
  // Prisma schema parser
  // -------------------------------------------------------------------------

  private parseBlocks(content: string): PrismaBlock[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const blocks: PrismaBlock[] = [];
    let current: PrismaBlock | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1; // 1-indexed

      if (!current) {
        const match = BLOCK_OPEN_RE.exec(line);
        if (match) {
          current = {
            blockType: match[1] as PrismaBlockType,
            name: match[2],
            startLine: lineNum,
            endLine: lineNum,
            fields: [],
          };
          braceDepth = 1;
        }
        continue;
      }

      // Count braces within the block
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      if (braceDepth <= 0) {
        current.endLine = lineNum;
        blocks.push(current);
        current = null;
        braceDepth = 0;
        continue;
      }

      // Parse field lines inside the block
      const trimmed = line.trim();
      // Skip empty lines, comments, and @@-level attributes
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
        continue;
      }

      if (current.blockType === 'enum') {
        // Enum values are just identifiers
        const enumValue = trimmed.split(/\s/)[0];
        if (enumValue && /^\w+$/.test(enumValue)) {
          current.fields.push({
            name: enumValue,
            type: 'String',
            isArray: false,
            isOptional: false,
            isId: false,
            isUnique: false,
            hasDefault: false,
            relationName: null,
            relationFields: [],
            relationReferences: [],
          });
        }
        continue;
      }

      // Parse model/type fields
      const fieldMatch = FIELD_RE.exec(line);
      if (!fieldMatch) continue;

      const [, fieldName, fieldType, arrayMarker, optionalMarker, attrs] = fieldMatch;
      const attrStr = (attrs ?? '').replace(/\/\/.*$/, '').trim();

      const field: PrismaField = {
        name: fieldName,
        type: fieldType,
        isArray: arrayMarker === '[]',
        isOptional: optionalMarker === '?',
        isId: ID_ATTR_RE.test(attrStr),
        isUnique: UNIQUE_ATTR_RE.test(attrStr),
        hasDefault: DEFAULT_ATTR_RE.test(attrStr),
        relationName: null,
        relationFields: [],
        relationReferences: [],
      };

      // Parse @relation(...) if present
      const relMatch = RELATION_RE.exec(attrStr);
      if (relMatch) {
        const relBody = relMatch[1];
        const nameMatch = RELATION_NAME_RE.exec(relBody);
        if (nameMatch) field.relationName = nameMatch[1];

        const fieldsMatch = RELATION_FIELDS_RE.exec(relBody);
        if (fieldsMatch) {
          field.relationFields = fieldsMatch[1].split(',').map(s => s.trim());
        }

        const refsMatch = RELATION_REFS_RE.exec(relBody);
        if (refsMatch) {
          field.relationReferences = refsMatch[1].split(',').map(s => s.trim());
        }
      }

      current.fields.push(field);
    }

    // Handle unclosed block (malformed schema)
    if (current) {
      current.endLine = lines.length;
      blocks.push(current);
    }

    return blocks;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private blockToNode(
    block: PrismaBlock,
    file: RepoFile,
    repoId: string,
  ): CIGNode {
    const symbolType = block.blockType === 'enum' ? 'enum' as const : 'schema' as const;
    const nodeId = `${repoId}:${file.filePath}:${block.name}:${symbolType}`;

    const metadata: Record<string, unknown> = {
      prismaType: block.blockType,
    };

    if (block.blockType === 'enum') {
      metadata.values = block.fields.map(f => f.name);
    } else {
      metadata.fields = block.fields.map(f => {
        const fieldMeta: Record<string, unknown> = {
          name: f.name,
          type: f.type,
        };
        if (f.isArray) fieldMeta.isArray = true;
        if (f.isOptional) fieldMeta.isOptional = true;
        if (f.isId) fieldMeta.isId = true;
        if (f.isUnique) fieldMeta.isUnique = true;
        if (f.hasDefault) fieldMeta.hasDefault = true;
        if (f.relationName) fieldMeta.relationName = f.relationName;
        if (f.relationFields.length) fieldMeta.relationFields = f.relationFields;
        if (f.relationReferences.length) fieldMeta.relationReferences = f.relationReferences;
        return fieldMeta;
      });

      // Extract relation targets for quick reference
      const relations = block.fields
        .filter(f => f.relationName || f.relationFields.length > 0)
        .map(f => ({
          field: f.name,
          target: f.type,
          relationName: f.relationName,
        }));
      if (relations.length) metadata.relations = relations;
    }

    return {
      nodeId,
      repoId,
      filePath: file.filePath,
      symbolName: block.name,
      symbolType,
      startLine: block.startLine,
      endLine: block.endLine,
      exported: true, // Prisma models are always "exported" (public schema)
      extractedSha: file.currentSha,
      metadata,
    };
  }
}
