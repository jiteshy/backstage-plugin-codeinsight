import * as fs from 'fs';
import * as path from 'path';

import { FileFilter } from '@codeinsight/ingestion';
import type { CIGNode, RepoFile } from '@codeinsight/types';

import { CIGBuilder } from '../CIGBuilder';
import { EntryPointDetector } from '../EntryPointDetector';
import { PrismaExtractor } from '../extractors/PrismaExtractor';
import { TypeScriptExtractor } from '../extractors/TypeScriptExtractor';
import { FrameworkSignalDetector } from '../FrameworkSignalDetector';
import type { CIGBuildResult } from '../types';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../../../../test/fixtures/sample-express-app',
);

function loadFixtureFiles(): Array<{ file: RepoFile; content: string }> {
  const filter = new FileFilter();
  const files: Array<{ file: RepoFile; content: string }> = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(FIXTURE_ROOT, fullPath);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath);
        continue;
      }

      if (filter.shouldExclude(relPath)) continue;

      const language = filter.detectLanguage(relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      files.push({
        file: {
          repoId: 'test-repo',
          filePath: relPath,
          currentSha: `sha-${relPath}`,
          fileType: filter.classifyFile(relPath),
          language,
          parseStatus: 'pending',
        },
        content,
      });
    }
  }

  walk(FIXTURE_ROOT);
  return files;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodesByType(result: CIGBuildResult, type: string): CIGNode[] {
  return result.nodes.filter(n => n.symbolType === type && n.symbolName !== '<module>');
}

function nodeNames(nodes: CIGNode[]): string[] {
  return nodes.map(n => n.symbolName).sort();
}

function edgesByType(result: CIGBuildResult, type: string) {
  return result.edges.filter(e => e.edgeType === type);
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('CIG Builder — integration (sample-express-app)', () => {
  let result: CIGBuildResult;
  let allFiles: Array<{ file: RepoFile; content: string }>;

  beforeAll(() => {
    // Verify fixture exists
    expect(fs.existsSync(FIXTURE_ROOT)).toBe(true);

    allFiles = loadFixtureFiles();

    const builder = new CIGBuilder();
    builder.registerExtractor(new TypeScriptExtractor());
    builder.registerContentExtractor(new PrismaExtractor());
    result = builder.build('test-repo', allFiles);
  });

  // -------------------------------------------------------------------------
  // Fixture sanity
  // -------------------------------------------------------------------------

  describe('fixture sanity', () => {
    it('loads all expected files', () => {
      const filePaths = allFiles.map(f => f.file.filePath).sort();
      expect(filePaths).toContain('src/index.ts');
      expect(filePaths).toContain('src/types/index.ts');
      expect(filePaths).toContain('src/routes/users.ts');
      expect(filePaths).toContain('src/routes/posts.ts');
      expect(filePaths).toContain('src/controllers/UserController.ts');
      expect(filePaths).toContain('src/controllers/PostController.ts');
      expect(filePaths).toContain('src/services/UserService.ts');
      expect(filePaths).toContain('src/services/PostService.ts');
      expect(filePaths).toContain('src/services/BaseService.ts');
      expect(filePaths).toContain('src/middleware/auth.ts');
      expect(filePaths).toContain('src/models/index.ts');
      expect(filePaths).toContain('prisma/schema.prisma');
    });

    it('processes all parseable files', () => {
      // TS files + prisma file
      const tsFiles = allFiles.filter(f => f.file.language === 'typescript');
      const prismaFiles = allFiles.filter(f => f.file.language === 'prisma');
      expect(tsFiles.length).toBeGreaterThanOrEqual(10);
      expect(prismaFiles).toHaveLength(1);
      expect(result.filesProcessed).toBeGreaterThanOrEqual(tsFiles.length + prismaFiles.length);
    });

    it('has no extraction errors', () => {
      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Symbol extraction
  // -------------------------------------------------------------------------

  describe('symbol extraction', () => {
    it('extracts all functions', () => {
      const functions = nodesByType(result, 'function');
      const names = nodeNames(functions);

      // From src/index.ts
      expect(names).toContain('startServer');

      // From src/middleware/auth.ts
      expect(names).toContain('authMiddleware');
      expect(names).toContain('verifyToken');
    });

    it('extracts all classes', () => {
      const classes = nodesByType(result, 'class');
      const names = nodeNames(classes);

      expect(names).toContain('UserController');
      expect(names).toContain('PostController');
      expect(names).toContain('UserService');
      expect(names).toContain('PostService');
      expect(names).toContain('BaseService');
    });

    it('extracts class methods', () => {
      const functions = nodesByType(result, 'function');
      const methodNames = functions
        .filter(n => n.symbolName.includes('.'))
        .map(n => n.symbolName)
        .sort();

      // UserController methods
      expect(methodNames).toContain('UserController.list');
      expect(methodNames).toContain('UserController.getById');
      expect(methodNames).toContain('UserController.create');
      expect(methodNames).toContain('UserController.delete');

      // PostController methods
      expect(methodNames).toContain('PostController.list');
      expect(methodNames).toContain('PostController.getById');
      expect(methodNames).toContain('PostController.create');
      expect(methodNames).toContain('PostController.publish');

      // Service methods
      expect(methodNames).toContain('UserService.getUsers');
      expect(methodNames).toContain('UserService.getUserById');
      expect(methodNames).toContain('UserService.createUser');
      expect(methodNames).toContain('UserService.deleteUser');
      expect(methodNames).toContain('PostService.getPosts');
      expect(methodNames).toContain('PostService.getPostById');
      expect(methodNames).toContain('PostService.getPostsByAuthor');
      expect(methodNames).toContain('PostService.createPost');
      expect(methodNames).toContain('PostService.publishPost');
    });

    it('extracts interfaces', () => {
      const interfaces = nodesByType(result, 'interface');
      const names = nodeNames(interfaces);

      expect(names).toContain('User');
      expect(names).toContain('Post');
      expect(names).toContain('PaginationOptions');
      expect(names).toContain('AuthRequest');
      expect(names).toContain('Database');
    });

    it('extracts enums', () => {
      const enums = nodesByType(result, 'enum');
      const names = nodeNames(enums);

      // From TypeScript
      expect(names).toContain('Role');
      expect(names).toContain('PostStatus');

      // From Prisma (also named Role and PostStatus but in different files)
      // Prisma enums are separate nodes with different filePaths
      const prismaEnums = enums.filter(n => n.filePath === 'prisma/schema.prisma');
      expect(prismaEnums.map(n => n.symbolName).sort()).toEqual(['PostStatus', 'Role']);
    });

    it('extracts type aliases', () => {
      const types = nodesByType(result, 'type');
      const names = nodeNames(types);

      expect(names).toContain('CreateUserInput');
      expect(names).toContain('CreatePostInput');
    });

    it('marks exported symbols correctly', () => {
      const functions = nodesByType(result, 'function');

      const startServer = functions.find(n => n.symbolName === 'startServer');
      expect(startServer).toBeDefined();
      expect(startServer!.exported).toBe(true);

      const verifyToken = functions.find(n => n.symbolName === 'verifyToken');
      expect(verifyToken).toBeDefined();
      expect(verifyToken!.exported).toBe(false);
    });

    it('has correct line ranges for symbols', () => {
      const classes = nodesByType(result, 'class');
      const userController = classes.find(n => n.symbolName === 'UserController');
      expect(userController).toBeDefined();
      expect(userController!.startLine).toBeGreaterThan(0);
      expect(userController!.endLine).toBeGreaterThan(userController!.startLine);
    });
  });

  // -------------------------------------------------------------------------
  // Route extraction
  // -------------------------------------------------------------------------

  describe('route extraction', () => {
    it('extracts all Express routes', () => {
      const routes = nodesByType(result, 'route');
      expect(routes.length).toBeGreaterThanOrEqual(8);
    });

    it('extracts user routes with correct methods and paths', () => {
      const routes = nodesByType(result, 'route').filter(
        n => n.filePath === 'src/routes/users.ts',
      );

      const routeInfo = routes.map(n => {
        const meta = n.metadata as Record<string, unknown>;
        return { method: meta.httpMethod, path: meta.routePath };
      });

      expect(routeInfo).toContainEqual({ method: 'GET', path: '/' });
      expect(routeInfo).toContainEqual({ method: 'GET', path: '/:id' });
      expect(routeInfo).toContainEqual({ method: 'POST', path: '/' });
      expect(routeInfo).toContainEqual({ method: 'DELETE', path: '/:id' });
    });

    it('extracts post routes with correct methods and paths', () => {
      const routes = nodesByType(result, 'route').filter(
        n => n.filePath === 'src/routes/posts.ts',
      );

      const routeInfo = routes.map(n => {
        const meta = n.metadata as Record<string, unknown>;
        return { method: meta.httpMethod, path: meta.routePath };
      });

      expect(routeInfo).toContainEqual({ method: 'GET', path: '/' });
      expect(routeInfo).toContainEqual({ method: 'GET', path: '/:id' });
      expect(routeInfo).toContainEqual({ method: 'POST', path: '/' });
      expect(routeInfo).toContainEqual({ method: 'PATCH', path: '/:id/publish' });
    });

    it('extracts the health route from index.ts', () => {
      const routes = nodesByType(result, 'route').filter(
        n => n.filePath === 'src/index.ts',
      );

      const healthRoute = routes.find(n => {
        const meta = n.metadata as Record<string, unknown>;
        return meta.routePath === '/health';
      });
      expect(healthRoute).toBeDefined();
      expect((healthRoute!.metadata as Record<string, unknown>).httpMethod).toBe('GET');
    });
  });

  // -------------------------------------------------------------------------
  // Import/export edges
  // -------------------------------------------------------------------------

  describe('import/export edges', () => {
    it('has import edges', () => {
      const importEdges = edgesByType(result, 'imports');
      expect(importEdges.length).toBeGreaterThanOrEqual(10);
    });

    it('captures index.ts importing from routes', () => {
      const importEdges = edgesByType(result, 'imports');
      const indexImports = importEdges.filter(e =>
        e.fromNodeId.includes('src/index.ts'),
      );

      const targets = indexImports.map(e => e.toNodeId);
      // Should import from routes/users and routes/posts
      expect(targets.some(t => t.includes('src/routes/users'))).toBe(true);
      expect(targets.some(t => t.includes('src/routes/posts'))).toBe(true);
    });

    it('captures cross-module import relationships', () => {
      const importEdges = edgesByType(result, 'imports');
      // Services import from types
      const serviceImports = importEdges.filter(
        e => e.fromNodeId.includes('services/'),
      );
      const targets = serviceImports.map(e => e.toNodeId);
      expect(targets.some(t => t.includes('types/'))).toBe(true);
    });

    it('captures controller importing from services', () => {
      const importEdges = edgesByType(result, 'imports');
      const controllerImports = importEdges.filter(
        e => e.fromNodeId.includes('controllers/'),
      );
      const importTargets = controllerImports.map(e => e.toNodeId);
      expect(importTargets.some(t => t.includes('services/'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Prisma schema extraction
  // -------------------------------------------------------------------------

  describe('Prisma schema extraction', () => {
    it('extracts Prisma models', () => {
      const schemas = nodesByType(result, 'schema').filter(
        n => n.filePath === 'prisma/schema.prisma',
      );
      const names = schemas.map(n => n.symbolName).sort();
      expect(names).toEqual(['Post', 'User']);
    });

    it('extracts Prisma model fields with metadata', () => {
      const schemas = nodesByType(result, 'schema');
      const userModel = schemas.find(
        n => n.symbolName === 'User' && n.filePath === 'prisma/schema.prisma',
      );
      expect(userModel).toBeDefined();

      const meta = userModel!.metadata as Record<string, unknown>;
      expect(meta.prismaType).toBe('model');

      const fields = meta.fields as Array<Record<string, unknown>>;
      const emailField = fields.find(f => f.name === 'email');
      expect(emailField).toEqual(expect.objectContaining({ type: 'String', isUnique: true }));

      const idField = fields.find(f => f.name === 'id');
      expect(idField).toEqual(expect.objectContaining({ type: 'Int', isId: true }));
    });

    it('extracts Prisma enums', () => {
      const enums = nodesByType(result, 'enum').filter(
        n => n.filePath === 'prisma/schema.prisma',
      );
      expect(enums).toHaveLength(2);

      const roleEnum = enums.find(n => n.symbolName === 'Role');
      expect(roleEnum).toBeDefined();
      const meta = roleEnum!.metadata as Record<string, unknown>;
      expect(meta.values).toEqual(['ADMIN', 'USER', 'MODERATOR']);
    });

    it('extracts Prisma relation edges', () => {
      const refEdges = edgesByType(result, 'references');
      expect(refEdges.length).toBeGreaterThanOrEqual(1);

      // Post.author → User
      const postToUser = refEdges.find(
        e =>
          e.fromNodeId === 'test-repo:prisma/schema.prisma:Post:schema' &&
          e.toNodeId === 'test-repo:prisma/schema.prisma:User:schema',
      );
      expect(postToUser).toBeDefined();

      // User.posts → Post (reverse relation)
      const userToPost = refEdges.find(
        e =>
          e.fromNodeId === 'test-repo:prisma/schema.prisma:User:schema' &&
          e.toNodeId === 'test-repo:prisma/schema.prisma:Post:schema',
      );
      expect(userToPost).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Framework signal detection
  // -------------------------------------------------------------------------

  describe('framework signal detection', () => {
    it('detects Express, Prisma, Jest from package.json', () => {
      const detector = new FrameworkSignalDetector();
      const pkgFile = allFiles.find(f => f.file.filePath === 'package.json');
      expect(pkgFile).toBeDefined();

      const signals = detector.detect([pkgFile!.content]);

      // Frameworks
      const frameworkNames = signals.frameworks.map(f => f.name);
      expect(frameworkNames).toContain('express');

      // ORMs
      const ormNames = signals.orms.map(o => o.name);
      expect(ormNames).toContain('prisma');

      // Test frameworks
      const testNames = signals.testFrameworks.map(t => t.name);
      expect(testNames).toContain('jest');

      // Auth libraries
      const authNames = signals.authLibraries.map(a => a.name);
      expect(authNames).toContain('jsonwebtoken');
    });
  });

  // -------------------------------------------------------------------------
  // Entry point detection
  // -------------------------------------------------------------------------

  describe('entry point detection', () => {
    it('detects src/index.ts as an entry point', () => {
      const detector = new EntryPointDetector();
      const entryPoints = detector.detect(result);

      const entryPaths = entryPoints.map(ep => ep.filePath);
      expect(entryPaths).toContain('src/index.ts');
    });
  });

  // -------------------------------------------------------------------------
  // Module nodes
  // -------------------------------------------------------------------------

  describe('module nodes', () => {
    it('creates a <module> node per processed file', () => {
      const moduleNodes = result.nodes.filter(n => n.symbolName === '<module>');
      expect(moduleNodes.length).toBe(result.filesProcessed);
    });

    it('module nodes span the file', () => {
      const moduleNodes = result.nodes.filter(n => n.symbolName === '<module>');
      for (const mod of moduleNodes) {
        expect(mod.startLine).toBe(1);
        expect(mod.endLine).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Overall stats
  // -------------------------------------------------------------------------

  describe('overall stats', () => {
    it('produces a reasonable number of nodes', () => {
      const nonModule = result.nodes.filter(n => n.symbolName !== '<module>');
      // We expect at least: 5 classes + many methods + 4+ enums + 5+ interfaces
      // + 2 type aliases + 8+ routes + 2 models + 2 free functions
      expect(nonModule.length).toBeGreaterThanOrEqual(30);
    });

    it('produces a reasonable number of edges', () => {
      // Import edges + extends edges + references edges
      expect(result.edges.length).toBeGreaterThanOrEqual(10);
    });

    it('has no skipped files (all fixture files are parseable)', () => {
      // package.json is not parseable (no extractor) — so it's skipped
      const parseableFiles = allFiles.filter(
        f => f.file.language === 'typescript' || f.file.language === 'prisma',
      );
      expect(result.filesProcessed).toBe(parseableFiles.length);
    });
  });
});
