import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';

import { CIGBuilder } from '../CIGBuilder';
import type { CIGBuildResult } from '../types';

import { TypeScriptExtractor } from './TypeScriptExtractor';

// ---------------------------------------------------------------------------
// Helpers — use CIGBuilder to parse (avoids raw Parser native module issues)
// ---------------------------------------------------------------------------

const makeFile = (filePath: string, language = 'typescript'): RepoFile => ({
  repoId: 'repo-1',
  filePath,
  currentSha: 'sha-abc',
  fileType: 'source',
  language,
  parseStatus: 'pending',
});

/** Extract symbols, filtering out the <module> node added by CIGBuilder. */
function extractSymbols(source: string, language = 'typescript'): CIGNode[] {
  const builder = new CIGBuilder();
  builder.registerExtractor(new TypeScriptExtractor());
  const file = makeFile('src/test.ts', language);
  const result = builder.build('repo-1', [{ file, content: source }]);
  return result.nodes.filter(n => n.symbolName !== '<module>');
}

/** Build a multi-file CIG and return the full result (including module nodes + edges). */
function buildMultiFile(
  files: Array<{ filePath: string; content: string; language?: string }>,
): CIGBuildResult {
  const builder = new CIGBuilder();
  builder.registerExtractor(new TypeScriptExtractor());
  return builder.build(
    'repo-1',
    files.map(f => ({
      file: makeFile(f.filePath, f.language ?? 'typescript'),
      content: f.content,
    })),
  );
}

function findNode(nodes: CIGNode[], name: string): CIGNode | undefined {
  return nodes.find(n => n.symbolName === name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeScriptExtractor — symbol extraction', () => {
  // -----------------------------------------------------------------------
  // Named functions
  // -----------------------------------------------------------------------

  describe('functions', () => {
    it('extracts a named function declaration', () => {
      const nodes = extractSymbols(`function greet(name: string): string {
  return name;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('greet');
      expect(nodes[0].symbolType).toBe('function');
      expect(nodes[0].exported).toBe(false);
      expect(nodes[0].startLine).toBe(1);
      expect(nodes[0].endLine).toBe(3);
    });

    it('extracts an exported named function', () => {
      const nodes = extractSymbols(`export function add(a: number, b: number): number {
  return a + b;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('add');
      expect(nodes[0].exported).toBe(true);
    });

    it('extracts export default function', () => {
      const nodes = extractSymbols(`export default function main() {}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('main');
      expect(nodes[0].exported).toBe(true);
    });

    it('extracts a generator function', () => {
      const nodes = extractSymbols(`function* range(start: number, end: number) {
  for (let i = start; i < end; i++) yield i;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('range');
      expect(nodes[0].symbolType).toBe('function');
    });

    it('does not duplicate symbols for export default of pre-declared identifier', () => {
      const nodes = extractSymbols(`class MyClass {}
export default MyClass;`);
      // Only the class declaration produces a symbol — the re-export does not
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('MyClass');
      expect(nodes[0].symbolType).toBe('class');
    });

    it('extracts an async function', () => {
      const nodes = extractSymbols(`export async function fetchData(url: string) {
  return fetch(url);
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('fetchData');
      expect(nodes[0].exported).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Arrow functions
  // -----------------------------------------------------------------------

  describe('arrow functions', () => {
    it('extracts an arrow function assigned to const', () => {
      const nodes = extractSymbols(`const add = (a: number, b: number): number => a + b;`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('add');
      expect(nodes[0].symbolType).toBe('function');
      expect(nodes[0].exported).toBe(false);
    });

    it('extracts an exported arrow function', () => {
      const nodes = extractSymbols(`export const multiply = (a: number, b: number) => a * b;`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('multiply');
      expect(nodes[0].exported).toBe(true);
    });

    it('extracts an arrow function with block body', () => {
      const nodes = extractSymbols(`const process = (data: string) => {
  return data.trim();
};`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('process');
    });

    it('does NOT extract non-function const declarations', () => {
      const nodes = extractSymbols(`export const PI = 3.14;
export const config = { port: 3000 };
export const items = [1, 2, 3];`);
      expect(nodes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Classes
  // -----------------------------------------------------------------------

  describe('classes', () => {
    it('extracts a class declaration', () => {
      const nodes = extractSymbols(`class MyService {
  run() {}
}`);
      const cls = findNode(nodes, 'MyService');
      expect(cls).toBeDefined();
      expect(cls!.symbolType).toBe('class');
      expect(cls!.exported).toBe(false);
    });

    it('extracts an exported class', () => {
      const nodes = extractSymbols(`export class UserService {
  findAll() {}
}`);
      const cls = findNode(nodes, 'UserService');
      expect(cls).toBeDefined();
      expect(cls!.exported).toBe(true);
    });

    it('extracts an abstract class', () => {
      const nodes = extractSymbols(`export abstract class BaseRepository {
  abstract find(id: string): Promise<unknown>;
}`);
      const cls = findNode(nodes, 'BaseRepository');
      expect(cls).toBeDefined();
      expect(cls!.symbolType).toBe('class');
      expect(cls!.exported).toBe(true);
    });

    it('extracts class methods with className prefix', () => {
      const nodes = extractSymbols(`export class Router {
  get() {}
  post() {}
  private validate() {}
  static create() {}
}`);
      expect(findNode(nodes, 'Router')).toBeDefined();
      expect(findNode(nodes, 'Router.get')).toBeDefined();
      expect(findNode(nodes, 'Router.post')).toBeDefined();
      expect(findNode(nodes, 'Router.validate')).toBeDefined();
      expect(findNode(nodes, 'Router.create')).toBeDefined();
      // 1 class + 4 methods
      expect(nodes).toHaveLength(5);
    });

    it('extracts getters and setters with distinct nodeIds', () => {
      const nodes = extractSymbols(`class Config {
  get port() { return 3000; }
  set port(v: number) {}
}`);
      // Class + getter + setter = 3
      expect(nodes).toHaveLength(3);
      const getter = findNode(nodes, 'Config.port:get');
      const setter = findNode(nodes, 'Config.port:set');
      expect(getter).toBeDefined();
      expect(setter).toBeDefined();
      expect(getter!.nodeId).not.toBe(setter!.nodeId);
    });

    it('stores className in metadata for methods', () => {
      const nodes = extractSymbols(`class Foo { bar() {} }`);
      const method = findNode(nodes, 'Foo.bar');
      expect(method).toBeDefined();
      expect(method!.metadata).toEqual({ className: 'Foo' });
    });
  });

  // -----------------------------------------------------------------------
  // Interfaces
  // -----------------------------------------------------------------------

  describe('interfaces', () => {
    it('extracts an interface', () => {
      const nodes = extractSymbols(`interface IRepository {
  findById(id: string): Promise<unknown>;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('IRepository');
      expect(nodes[0].symbolType).toBe('interface');
      expect(nodes[0].exported).toBe(false);
    });

    it('extracts an exported interface', () => {
      const nodes = extractSymbols(`export interface Logger {
  info(msg: string): void;
  error(msg: string, err?: Error): void;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('Logger');
      expect(nodes[0].exported).toBe(true);
    });

    it('extracts a generic interface', () => {
      const nodes = extractSymbols(`export interface Result<T, E = Error> {
  data: T | null;
  error: E | null;
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('Result');
      expect(nodes[0].symbolType).toBe('interface');
    });
  });

  // -----------------------------------------------------------------------
  // Type aliases
  // -----------------------------------------------------------------------

  describe('type aliases', () => {
    it('extracts a type alias', () => {
      const nodes = extractSymbols(`type Status = 'active' | 'inactive';`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('Status');
      expect(nodes[0].symbolType).toBe('type');
    });

    it('extracts an exported generic type alias', () => {
      const nodes = extractSymbols(
        `export type Result<T> = { data: T; error: null } | { data: null; error: Error };`,
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('Result');
      expect(nodes[0].exported).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Enums
  // -----------------------------------------------------------------------

  describe('enums', () => {
    it('extracts an enum', () => {
      const nodes = extractSymbols(`enum Direction {
  Up = 'up',
  Down = 'down',
}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('Direction');
      expect(nodes[0].symbolType).toBe('enum');
    });

    it('extracts an exported const enum', () => {
      const nodes = extractSymbols(`export const enum Color { Red, Green, Blue }`);
      // const enum is still enum_declaration in TS grammar
      const e = findNode(nodes, 'Color');
      expect(e).toBeDefined();
      expect(e!.symbolType).toBe('enum');
      expect(e!.exported).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Nested functions
  // -----------------------------------------------------------------------

  describe('nested functions', () => {
    it('extracts nested function declarations', () => {
      const nodes = extractSymbols(`function outer() {
  function inner() {
    return 42;
  }
  return inner();
}`);
      expect(findNode(nodes, 'outer')).toBeDefined();
      expect(findNode(nodes, 'inner')).toBeDefined();
      expect(nodes).toHaveLength(2);
    });

    it('extracts deeply nested functions', () => {
      const nodes = extractSymbols(`function level1() {
  function level2() {
    function level3() {}
  }
}`);
      expect(nodes).toHaveLength(3);
      expect(findNode(nodes, 'level1')).toBeDefined();
      expect(findNode(nodes, 'level2')).toBeDefined();
      expect(findNode(nodes, 'level3')).toBeDefined();
    });

    it('extracts nested arrow functions in variable declarations', () => {
      const nodes = extractSymbols(`function outer() {
  const helper = () => {};
}`);
      expect(findNode(nodes, 'outer')).toBeDefined();
      expect(findNode(nodes, 'helper')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Line ranges
  // -----------------------------------------------------------------------

  describe('line ranges', () => {
    it('tracks correct start/end lines for multi-line constructs', () => {
      const source = `// line 1
export function foo(
  a: string,
  b: number,
): void {
  console.log(a, b);
}
// line 8`;
      const nodes = extractSymbols(source);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].startLine).toBe(2);
      expect(nodes[0].endLine).toBe(7);
    });

    it('tracks correct lines for a class spanning many lines', () => {
      const source = `class Big {
  a() {}
  b() {}
  c() {}
}`;
      const nodes = extractSymbols(source);
      const cls = findNode(nodes, 'Big');
      expect(cls!.startLine).toBe(1);
      expect(cls!.endLine).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Mixed file — integration
  // -----------------------------------------------------------------------

  describe('mixed file extraction', () => {
    it('extracts all symbol types from a realistic file', () => {
      const source = `
import { Router } from 'express';

export interface UserDTO {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'user' | 'guest';

export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

export class UserService {
  private cache: Map<string, UserDTO> = new Map();

  async findById(id: string): Promise<UserDTO | null> {
    return this.cache.get(id) ?? null;
  }

  async create(data: Partial<UserDTO>): Promise<UserDTO> {
    const user: UserDTO = { id: 'new', name: data.name ?? '' };
    this.cache.set(user.id, user);
    return user;
  }
}

export const createRouter = (service: UserService) => {
  const router = Router();
  return router;
};

function internalHelper() {
  return true;
}
`;
      const nodes = extractSymbols(source);

      // interface
      expect(findNode(nodes, 'UserDTO')?.symbolType).toBe('interface');
      expect(findNode(nodes, 'UserDTO')?.exported).toBe(true);

      // type alias
      expect(findNode(nodes, 'UserRole')?.symbolType).toBe('type');
      expect(findNode(nodes, 'UserRole')?.exported).toBe(true);

      // enum
      expect(findNode(nodes, 'Status')?.symbolType).toBe('enum');
      expect(findNode(nodes, 'Status')?.exported).toBe(true);

      // class + methods
      expect(findNode(nodes, 'UserService')?.symbolType).toBe('class');
      expect(findNode(nodes, 'UserService')?.exported).toBe(true);
      expect(findNode(nodes, 'UserService.findById')?.symbolType).toBe('function');
      expect(findNode(nodes, 'UserService.create')?.symbolType).toBe('function');

      // exported arrow function
      expect(findNode(nodes, 'createRouter')?.symbolType).toBe('function');
      expect(findNode(nodes, 'createRouter')?.exported).toBe(true);

      // internal function
      expect(findNode(nodes, 'internalHelper')?.symbolType).toBe('function');
      expect(findNode(nodes, 'internalHelper')?.exported).toBe(false);

      // Total: interface + type + enum + class + 2 methods + arrow fn + internal fn = 8
      expect(nodes).toHaveLength(8);
    });
  });

  // -----------------------------------------------------------------------
  // nodeId format
  // -----------------------------------------------------------------------

  describe('nodeId format', () => {
    it('uses repoId:filePath:symbolName:symbolType format', () => {
      const nodes = extractSymbols(`export function hello() {}`);
      expect(nodes[0].nodeId).toBe('repo-1:src/test.ts:hello:function');
    });

    it('uses extractedSha from file', () => {
      const nodes = extractSymbols(`export class Foo {}`);
      expect(nodes[0].extractedSha).toBe('sha-abc');
    });
  });

  // -----------------------------------------------------------------------
  // Integration with CIGBuilder
  // -----------------------------------------------------------------------

  describe('CIGBuilder integration', () => {
    it('works when registered with CIGBuilder', () => {
      const builder = new CIGBuilder();
      builder.registerExtractor(new TypeScriptExtractor());

      const source = `
export function greet() {}
export class Service { run() {} }
export interface Config { port: number; }
`;
      const result = builder.build('repo-1', [
        { file: makeFile('src/app.ts'), content: source },
      ]);

      expect(result.filesProcessed).toBe(1);
      expect(result.errors).toHaveLength(0);
      // function + class + method + interface + <module> = 5
      const symbols = result.nodes.filter(n => n.symbolName !== '<module>');
      expect(symbols).toHaveLength(4);
      expect(symbols.map(n => n.symbolName).sort()).toEqual([
        'Config',
        'Service',
        'Service.run',
        'greet',
      ]);
      // Module node exists
      expect(result.nodes.find(n => n.symbolName === '<module>')).toBeDefined();
    });

    it('handles multiple files', () => {
      const builder = new CIGBuilder();
      builder.registerExtractor(new TypeScriptExtractor());

      const result = builder.build('repo-1', [
        {
          file: makeFile('src/a.ts'),
          content: `export function foo() {}`,
        },
        {
          file: makeFile('src/b.ts'),
          content: `export class Bar { baz() {} }`,
        },
        {
          file: makeFile('src/c.js', 'javascript'),
          content: `function qux() {}`,
        },
      ]);

      expect(result.filesProcessed).toBe(3);
      // foo + Bar + Bar.baz + qux = 4 symbols + 3 module nodes = 7
      const symbols = result.nodes.filter(n => n.symbolName !== '<module>');
      expect(symbols).toHaveLength(4);
      expect(result.nodes.filter(n => n.symbolName === '<module>')).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // TSX support
  // -----------------------------------------------------------------------

  describe('TSX support', () => {
    it('extracts symbols from TSX files', () => {
      const source = `
export interface Props {
  name: string;
}

export const Greeting = ({ name }: Props) => {
  return <div>Hello {name}</div>;
};

export default function App() {
  return <Greeting name="World" />;
}
`;
      const nodes = extractSymbols(source, 'tsx');
      expect(findNode(nodes, 'Props')?.symbolType).toBe('interface');
      expect(findNode(nodes, 'Greeting')?.symbolType).toBe('function');
      expect(findNode(nodes, 'App')?.symbolType).toBe('function');
    });
  });
});

// ===========================================================================
// Edge extraction tests (Phase 1.7.3)
// ===========================================================================

describe('TypeScriptExtractor — edge extraction', () => {
  function findEdge(edges: CIGEdge[], fromFile: string, toSymbol: string): CIGEdge | undefined {
    return edges.find(
      e => e.fromNodeId.includes(fromFile) && e.toNodeId.includes(toSymbol),
    );
  }

  // -----------------------------------------------------------------------
  // Named imports
  // -----------------------------------------------------------------------

  describe('named imports', () => {
    it('creates import edges for named imports', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/utils.ts',
          content: `export function formatDate() {}
export function parseDate() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import { formatDate, parseDate } from './utils';
export function main() { formatDate(); parseDate(); }`,
        },
      ]);

      expect(result.errors).toHaveLength(0);
      // Two import edges: app -> formatDate, app -> parseDate
      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(2);
      expect(findEdge(importEdges, 'src/app.ts', 'formatDate')).toBeDefined();
      expect(findEdge(importEdges, 'src/app.ts', 'parseDate')).toBeDefined();
    });

    it('resolves imports with file extension omitted', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/helpers.ts',
          content: `export class Helper {}`,
        },
        {
          filePath: 'src/main.ts',
          content: `import { Helper } from './helpers';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/helpers.ts:Helper:class');
    });

    it('resolves index file imports', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/lib/index.ts',
          content: `export function libFn() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import { libFn } from './lib';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/lib/index.ts:libFn:function');
    });

    it('handles aliased imports (import { Foo as Bar })', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/types.ts',
          content: `export interface Config { port: number; }`,
        },
        {
          filePath: 'src/app.ts',
          content: `import { Config as AppConfig } from './types';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      // Edge points to the original symbol name in the source file
      expect(importEdges[0].toNodeId).toBe('repo-1:src/types.ts:Config:interface');
    });
  });

  // -----------------------------------------------------------------------
  // Default imports
  // -----------------------------------------------------------------------

  describe('default imports', () => {
    it('creates edge for default import', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/service.ts',
          content: `export default function createService() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import createService from './service';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      // Default imports point to the target module node
      expect(importEdges[0].fromNodeId).toBe('repo-1:src/app.ts:<module>:variable');
      expect(importEdges[0].toNodeId).toBe('repo-1:src/service.ts:<module>:variable');
    });
  });

  // -----------------------------------------------------------------------
  // Namespace imports
  // -----------------------------------------------------------------------

  describe('namespace imports', () => {
    it('creates edge for namespace import (import * as)', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/utils.ts',
          content: `export function foo() {}
export function bar() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import * as utils from './utils';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].fromNodeId).toBe('repo-1:src/app.ts:<module>:variable');
      expect(importEdges[0].toNodeId).toBe('repo-1:src/utils.ts:<module>:variable');
    });
  });

  // -----------------------------------------------------------------------
  // Side-effect imports
  // -----------------------------------------------------------------------

  describe('side-effect imports', () => {
    it('creates edge for side-effect import (import "./module")', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/polyfill.ts',
          content: `// side effects only`,
        },
        {
          filePath: 'src/app.ts',
          content: `import './polyfill';
export function main() {}`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/polyfill.ts:<module>:variable');
    });
  });

  // -----------------------------------------------------------------------
  // Re-exports
  // -----------------------------------------------------------------------

  describe('re-exports', () => {
    it('creates edges for named re-exports (export { x } from)', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/types.ts',
          content: `export interface User { id: string; }
export type Role = 'admin' | 'user';`,
        },
        {
          filePath: 'src/index.ts',
          content: `export { User, Role } from './types';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(2);
      expect(findEdge(importEdges, 'src/index.ts', 'User')).toBeDefined();
      expect(findEdge(importEdges, 'src/index.ts', 'Role')).toBeDefined();
    });

    it('creates edge for export * from', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/helpers.ts',
          content: `export function help() {}`,
        },
        {
          filePath: 'src/index.ts',
          content: `export * from './helpers';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].fromNodeId).toBe('repo-1:src/index.ts:<module>:variable');
      expect(importEdges[0].toNodeId).toBe('repo-1:src/helpers.ts:<module>:variable');
    });

    it('creates edge for export { default as X } from', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/service.ts',
          content: `export default function createService() {}`,
        },
        {
          filePath: 'src/index.ts',
          content: `export { default as createService } from './service';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      // 'default' maps to the module node
      expect(importEdges[0].toNodeId).toBe('repo-1:src/service.ts:<module>:variable');
    });
  });

  // -----------------------------------------------------------------------
  // External / bare imports (should be skipped)
  // -----------------------------------------------------------------------

  describe('external imports', () => {
    it('ignores bare/external imports (no edge created)', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/app.ts',
          content: `import express from 'express';
import { Router } from 'express';
import React from 'react';
export function main() {}`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Unresolvable paths
  // -----------------------------------------------------------------------

  describe('unresolvable imports', () => {
    it('ignores imports to files not in the build set', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/app.ts',
          content: `import { missing } from './not-in-build';
export function main() {}`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Type imports
  // -----------------------------------------------------------------------

  describe('type imports', () => {
    it('creates edges for type-only imports', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/types.ts',
          content: `export interface User { id: string; }`,
        },
        {
          filePath: 'src/service.ts',
          content: `import type { User } from './types';
export function getUser(): User { return { id: '1' }; }`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/types.ts:User:interface');
    });
  });

  // -----------------------------------------------------------------------
  // Mixed imports in a single statement
  // -----------------------------------------------------------------------

  describe('mixed import forms', () => {
    it('handles default + named imports in one statement', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/lib.ts',
          content: `export default function main() {}
export function helper() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import main, { helper } from './lib';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      // default import → module node + named import → helper symbol = 2
      expect(importEdges).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Module nodes
  // -----------------------------------------------------------------------

  describe('module nodes', () => {
    it('creates a <module> node for each processed file', () => {
      const result = buildMultiFile([
        { filePath: 'src/a.ts', content: `export function foo() {}` },
        { filePath: 'src/b.ts', content: `export class Bar {}` },
      ]);

      const moduleNodes = result.nodes.filter(n => n.symbolName === '<module>');
      expect(moduleNodes).toHaveLength(2);
      expect(moduleNodes.map(n => n.filePath).sort()).toEqual(['src/a.ts', 'src/b.ts']);
      expect(moduleNodes[0].symbolType).toBe('variable');
    });
  });

  // -----------------------------------------------------------------------
  // Edge deduplication
  // -----------------------------------------------------------------------

  describe('edge properties', () => {
    it('edges have deterministic edgeIds', () => {
      const result = buildMultiFile([
        { filePath: 'src/utils.ts', content: `export function foo() {}` },
        { filePath: 'src/app.ts', content: `import { foo } from './utils';` },
      ]);

      const edge = result.edges[0];
      expect(edge.edgeId).toBe(
        'repo-1:src/app.ts:<module>:variable->imports->repo-1:src/utils.ts:foo:function',
      );
      expect(edge.repoId).toBe('repo-1');
      expect(edge.edgeType).toBe('imports');
    });
  });

  // -----------------------------------------------------------------------
  // Named import fallback — symbol not found in target
  // -----------------------------------------------------------------------

  describe('named import fallback', () => {
    it('falls back to module edge when imported symbol is not an exported node in the target file', () => {
      // 'secret' is declared but NOT exported in utils.ts, so the CIG has no
      // matching exported node. The extractor must fall back to a module edge
      // rather than dropping the edge entirely.
      const result = buildMultiFile([
        {
          filePath: 'src/utils.ts',
          content: `export function helper() {}
function secret() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import { secret } from './utils';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      // Fallback: points to the target module node, not a symbol node
      expect(importEdges[0].toNodeId).toBe('repo-1:src/utils.ts:<module>:variable');
      expect(importEdges[0].fromNodeId).toBe('repo-1:src/app.ts:<module>:variable');
    });

    it('falls back to module edge when a named re-export references a symbol not exported from the target', () => {
      // 'internal' is not exported in helpers.ts; index.ts tries to re-export it.
      // The extractor must still produce an edge (to the module) rather than silently dropping it.
      const result = buildMultiFile([
        {
          filePath: 'src/helpers.ts',
          content: `function internal() {}`,
        },
        {
          filePath: 'src/index.ts',
          content: `export { internal } from './helpers';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/helpers.ts:<module>:variable');
    });
  });

  // -----------------------------------------------------------------------
  // resolveImportPath — exact path match (specifier already has extension)
  // -----------------------------------------------------------------------

  describe('import path resolution', () => {
    it('resolves an import specifier that already includes the .ts extension', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/utils.ts',
          content: `export function foo() {}`,
        },
        {
          filePath: 'src/app.ts',
          content: `import { foo } from './utils.ts';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/utils.ts:foo:function');
    });

    it('resolves a .tsx file when the import specifier has no extension', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/Button.tsx',
          content: `export function Button() {}`,
          language: 'tsx',
        },
        {
          filePath: 'src/App.tsx',
          content: `import { Button } from './Button';`,
          language: 'tsx',
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/Button.tsx:Button:function');
    });

    it('resolves a .js file when the import specifier has no extension', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/util.js',
          content: `export function jsHelper() {}`,
          language: 'javascript',
        },
        {
          filePath: 'src/main.ts',
          content: `import { jsHelper } from './util';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(1);
      expect(importEdges[0].toNodeId).toBe('repo-1:src/util.js:jsHelper:function');
    });
  });

  // -----------------------------------------------------------------------
  // External re-exports are skipped
  // -----------------------------------------------------------------------

  describe('external re-exports', () => {
    it('ignores re-exports sourced from external packages (no edge created)', () => {
      // export { something } from 'external-pkg' — isRelativeImport returns false
      const result = buildMultiFile([
        {
          filePath: 'src/index.ts',
          content: `export { Component } from 'react';
export { default as lodash } from 'lodash';`,
        },
      ]);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');
      expect(importEdges).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge extraction error handling (CIGBuilder.build try/catch)
  // -----------------------------------------------------------------------

  describe('edge extraction error handling', () => {
    it('records an error and continues when extractEdges throws for one file', () => {
      // Register an extractor whose extractEdges throws on the first call.
      // The second file must still be processed.
      const { CIGBuilder: CIGBuilderCtor } = jest.requireActual('../CIGBuilder') as typeof import('../CIGBuilder');
      const builder = new CIGBuilderCtor();

      let callCount = 0;
      const faultyExtractor = {
        languages: ['typescript' as const],
        extractSymbols: new TypeScriptExtractor().extractSymbols.bind(new TypeScriptExtractor()),
        extractEdges: (...args: Parameters<TypeScriptExtractor['extractEdges']>) => {
          callCount++;
          if (callCount === 1) throw new Error('edge extraction boom');
          return new TypeScriptExtractor().extractEdges(...args);
        },
      };
      builder.registerExtractor(faultyExtractor);

      const result = builder.build('repo-1', [
        { file: makeFile('src/a.ts'), content: `export function a() {}` },
        { file: makeFile('src/b.ts'), content: `import { a } from './a';` },
      ]);

      // One error recorded for the file that threw
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toMatch(/Edge extraction failed/);
      // Both files were still symbol-processed
      expect(result.filesProcessed).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Complex multi-file scenario
  // -----------------------------------------------------------------------

  describe('complex multi-file import graph (including routes)', () => {
    it('builds correct import graph for a multi-file project', () => {
      const result = buildMultiFile([
        {
          filePath: 'src/types.ts',
          content: `export interface User { id: string; name: string; }
export type Role = 'admin' | 'user';`,
        },
        {
          filePath: 'src/db.ts',
          content: `import type { User } from './types';
export class UserRepository {
  async findById(id: string): Promise<User | null> { return null; }
}`,
        },
        {
          filePath: 'src/service.ts',
          content: `import type { User, Role } from './types';
import { UserRepository } from './db';
export class UserService {
  constructor(private repo: UserRepository) {}
  async getUser(id: string): Promise<User | null> { return this.repo.findById(id); }
}`,
        },
        {
          filePath: 'src/index.ts',
          content: `export { UserService } from './service';
export type { User, Role } from './types';
export * from './db';`,
        },
      ]);

      expect(result.errors).toHaveLength(0);

      const importEdges = result.edges.filter(e => e.edgeType === 'imports');

      // db.ts imports: User from types (1 edge)
      const dbEdges = importEdges.filter(e => e.fromNodeId.includes('src/db.ts'));
      expect(dbEdges).toHaveLength(1);

      // service.ts imports: User + Role from types (2), UserRepository from db (1) = 3
      const serviceEdges = importEdges.filter(e => e.fromNodeId.includes('src/service.ts'));
      expect(serviceEdges).toHaveLength(3);

      // index.ts re-exports: UserService from service (1), User + Role from types (2),
      // * from db (1) = 4
      const indexEdges = importEdges.filter(e => e.fromNodeId.includes('src/index.ts'));
      expect(indexEdges).toHaveLength(4);

      // Total: 1 + 3 + 4 = 8 import edges
      expect(importEdges).toHaveLength(8);
    });
  });
});

// ===========================================================================
// Route extraction tests (Phase 1.7.6)
// ===========================================================================

describe('TypeScriptExtractor — route extraction', () => {
  /** Extract only route nodes from the symbol result. */
  function extractRoutes(source: string, language = 'typescript'): CIGNode[] {
    const builder = new CIGBuilder();
    builder.registerExtractor(new TypeScriptExtractor());
    const file: RepoFile = {
      repoId: 'repo-1',
      filePath: 'src/routes.ts',
      currentSha: 'sha-abc',
      fileType: 'source',
      language,
      parseStatus: 'pending',
    };
    const result = builder.build('repo-1', [{ file, content: source }]);
    return result.nodes.filter(n => n.symbolType === 'route');
  }

  // -----------------------------------------------------------------------
  // Basic HTTP methods
  // -----------------------------------------------------------------------

  describe('basic HTTP method routes', () => {
    it('extracts router.get()', () => {
      const routes = extractRoutes(`
import { Router } from 'express';
const router = Router();
router.get('/users', getUsers);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('GET /users');
      expect(routes[0].symbolType).toBe('route');
      expect(routes[0].metadata).toEqual({
        httpMethod: 'GET',
        routePath: '/users',
        handler: 'getUsers',
      });
    });

    it('extracts app.post()', () => {
      const routes = extractRoutes(`
import express from 'express';
const app = express();
app.post('/users', createUser);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('POST /users');
      expect(routes[0].metadata).toEqual({
        httpMethod: 'POST',
        routePath: '/users',
        handler: 'createUser',
      });
    });

    it('extracts app.put()', () => {
      const routes = extractRoutes(`
const app = express();
app.put('/users/:id', updateUser);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('PUT /users/:id');
      expect(routes[0].metadata?.httpMethod).toBe('PUT');
    });

    it('extracts app.patch()', () => {
      const routes = extractRoutes(`
const app = express();
app.patch('/users/:id', patchUser);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].metadata?.httpMethod).toBe('PATCH');
    });

    it('extracts app.delete()', () => {
      const routes = extractRoutes(`
const app = express();
app.delete('/users/:id', deleteUser);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('DELETE /users/:id');
    });

    it('extracts app.head() and app.options()', () => {
      const routes = extractRoutes(`
const app = express();
app.head('/health', headHandler);
app.options('/cors', corsHandler);
`);
      expect(routes).toHaveLength(2);
      expect(routes[0].symbolName).toBe('HEAD /health');
      expect(routes[1].symbolName).toBe('OPTIONS /cors');
    });

    it('extracts app.all()', () => {
      const routes = extractRoutes(`
const app = express();
app.all('/catchall', catchAll);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('ALL /catchall');
    });
  });

  // -----------------------------------------------------------------------
  // router.use() with path prefix
  // -----------------------------------------------------------------------

  describe('router.use() with path', () => {
    it('extracts router.use() with a path prefix', () => {
      const routes = extractRoutes(`
const router = Router();
router.use('/api', apiRouter);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('USE /api');
      expect(routes[0].metadata).toEqual({
        httpMethod: 'USE',
        routePath: '/api',
        handler: 'apiRouter',
      });
    });

    it('skips router.use() without a string path (middleware-only)', () => {
      const routes = extractRoutes(`
const router = Router();
router.use(corsMiddleware);
router.use(express.json());
`);
      expect(routes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple middlewares
  // -----------------------------------------------------------------------

  describe('middleware arguments', () => {
    it('captures the last argument as handler when multiple middlewares are present', () => {
      const routes = extractRoutes(`
const router = Router();
router.post('/data', auth, validate, handleData);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].metadata?.handler).toBe('handleData');
    });

    it('returns null handler for inline arrow function', () => {
      const routes = extractRoutes(`
const app = express();
app.get('/inline', (req, res) => res.send('ok'));
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('GET /inline');
      expect(routes[0].metadata).toEqual({
        httpMethod: 'GET',
        routePath: '/inline',
      });
    });
  });

  // -----------------------------------------------------------------------
  // Member expression handlers
  // -----------------------------------------------------------------------

  describe('member expression handlers', () => {
    it('captures controller.method as handler', () => {
      const routes = extractRoutes(`
const router = Router();
router.get('/items', controller.listItems);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].metadata?.handler).toBe('controller.listItems');
    });
  });

  // -----------------------------------------------------------------------
  // Multiple routes in one file
  // -----------------------------------------------------------------------

  describe('multiple routes', () => {
    it('extracts all routes from a typical Express router file', () => {
      const routes = extractRoutes(`
import { Router } from 'express';

const router = Router();

router.get('/users', listUsers);
router.get('/users/:id', getUser);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

export default router;
`);
      expect(routes).toHaveLength(5);
      expect(routes.map(r => r.symbolName)).toEqual([
        'GET /users',
        'GET /users/:id',
        'POST /users',
        'PUT /users/:id',
        'DELETE /users/:id',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Non-router objects are ignored
  // -----------------------------------------------------------------------

  describe('non-router objects', () => {
    it('ignores method calls on unknown objects', () => {
      const routes = extractRoutes(`
const db = createDb();
db.get('/key', fetchKey);
`);
      expect(routes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // server object
  // -----------------------------------------------------------------------

  describe('server object', () => {
    it('extracts routes from a "server" object', () => {
      const routes = extractRoutes(`
const server = fastify();
server.get('/health', healthCheck);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('GET /health');
    });
  });

  // -----------------------------------------------------------------------
  // Line numbers
  // -----------------------------------------------------------------------

  describe('line numbers', () => {
    it('captures correct start and end lines for route calls', () => {
      const routes = extractRoutes(`
const router = Router();
router.get('/test', handler);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].startLine).toBe(3);
      expect(routes[0].endLine).toBe(3);
    });

    it('captures multi-line route calls', () => {
      const routes = extractRoutes(`
const router = Router();
router.post(
  '/multi',
  authMiddleware,
  validate,
  handleMulti
);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].startLine).toBe(3);
      expect(routes[0].endLine).toBe(8);
    });
  });

  // -----------------------------------------------------------------------
  // nodeId format
  // -----------------------------------------------------------------------

  describe('nodeId format', () => {
    it('has correct nodeId format for route nodes', () => {
      const routes = extractRoutes(`
const app = express();
app.get('/api/v1/items', listItems);
`);
      expect(routes).toHaveLength(1);
      expect(routes[0].nodeId).toBe('repo-1:src/routes.ts:GET#/api/v1/items:route');
    });
  });

  // -----------------------------------------------------------------------
  // JavaScript files
  // -----------------------------------------------------------------------

  describe('JavaScript files', () => {
    it('extracts routes from plain JavaScript files', () => {
      const routes = extractRoutes(`
const express = require('express');
const router = express.Router();
router.get('/js-route', jsHandler);
`, 'javascript');
      expect(routes).toHaveLength(1);
      expect(routes[0].symbolName).toBe('GET /js-route');
    });
  });

  // -----------------------------------------------------------------------
  // Chained route syntax
  // -----------------------------------------------------------------------

  describe('chained route syntax', () => {
    it('extracts chained router.route().get() calls', () => {
      const routes = extractRoutes(`
const router = Router();
router.route('/users').get(listUsers).post(createUser);
`);
      expect(routes).toHaveLength(2);
      const names = routes.map(r => r.symbolName).sort();
      expect(names).toEqual(['GET /users', 'POST /users']);
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate route registrations
  // -----------------------------------------------------------------------

  describe('duplicate routes', () => {
    it('emits two nodes when the same route is registered twice', () => {
      const routes = extractRoutes(`
const router = Router();
router.get('/health', handler1);
router.get('/health', handler2);
`);
      expect(routes).toHaveLength(2);
      // Both have the same nodeId — known limitation
      expect(routes[0].nodeId).toBe(routes[1].nodeId);
    });
  });

  // -----------------------------------------------------------------------
  // Coexistence with symbol extraction
  // -----------------------------------------------------------------------

  describe('coexistence with symbol extraction', () => {
    it('route nodes coexist with function/class symbols', () => {
      const builder = new CIGBuilder();
      builder.registerExtractor(new TypeScriptExtractor());
      const file: RepoFile = {
        repoId: 'repo-1',
        filePath: 'src/server.ts',
        currentSha: 'sha-abc',
        fileType: 'source',
        language: 'typescript',
        parseStatus: 'pending',
      };
      const result = builder.build('repo-1', [{
        file,
        content: `
import express from 'express';

const app = express();

function getHealth(req: any, res: any) {
  res.json({ status: 'ok' });
}

export class UserController {
  list(req: any, res: any) {}
}

app.get('/health', getHealth);
app.get('/users', UserController.prototype.list);
`,
      }]);

      const symbols = result.nodes.filter(n => n.symbolName !== '<module>');
      const functions = symbols.filter(n => n.symbolType === 'function');
      const classes = symbols.filter(n => n.symbolType === 'class');
      const routes = symbols.filter(n => n.symbolType === 'route');

      expect(functions.map(f => f.symbolName)).toContain('getHealth');
      expect(functions.map(f => f.symbolName)).toContain('UserController.list');
      expect(classes.map(c => c.symbolName)).toContain('UserController');
      expect(routes).toHaveLength(2);
      expect(routes[0].symbolName).toBe('GET /health');
      expect(routes[1].symbolName).toBe('GET /users');
    });
  });
});
