import type { CIGNode, RepoFile } from '@codeinsight/types';

import { CIGBuilder } from '../CIGBuilder';

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

function extractSymbols(source: string, language = 'typescript'): CIGNode[] {
  const builder = new CIGBuilder();
  builder.registerExtractor(new TypeScriptExtractor());
  const file = makeFile('src/test.ts', language);
  const result = builder.build('repo-1', [{ file, content: source }]);
  return result.nodes;
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
      // function + class + method + interface = 4
      expect(result.nodes).toHaveLength(4);
      expect(result.nodes.map(n => n.symbolName).sort()).toEqual([
        'Config',
        'Service',
        'Service.run',
        'greet',
      ]);
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
      // foo + Bar + Bar.baz + qux = 4
      expect(result.nodes).toHaveLength(4);
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
