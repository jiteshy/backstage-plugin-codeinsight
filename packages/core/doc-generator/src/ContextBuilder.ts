import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';

import { PromptRegistry } from './PromptRegistry';
import type { ClassifierResult, PromptContext } from './types';

// ---------------------------------------------------------------------------
// ContextBuilder — builds prompt context from CIG + files for each module
// ---------------------------------------------------------------------------

/**
 * Builds the prompt context for a single doc module by:
 * 1. Selecting the relevant files from the CIG / file tree
 * 2. Reading their content from the cloned repo
 * 3. Substituting template variables into the prompt
 * 4. Tracking which files (+ SHAs) were used as inputs
 */
export class ContextBuilder {
  private readonly promptRegistry = new PromptRegistry();

  constructor(
    private readonly nodes: CIGNode[],
    private readonly edges: CIGEdge[],
    private readonly repoFiles: RepoFile[],
    private readonly classifierResult: ClassifierResult,
    private readonly cloneDir: string,
    private readonly fileSummaries: Map<string, string> = new Map(),
  ) {}

  /**
   * Build the full prompt context for a module.
   * Returns null if the module is unsupported in the registry.
   */
  async buildContext(moduleId: string): Promise<PromptContext | null> {
    const definition = this.promptRegistry.getDefinition(moduleId);
    if (!definition) return null;

    const vars = await this.buildVars(moduleId);
    if (!vars) return null;

    const userPrompt = definition.buildUserPrompt(vars.variables);

    return {
      systemPrompt: definition.systemPrompt,
      userPrompt,
      inputFiles: vars.inputFiles,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — per-module variable builders
  // ---------------------------------------------------------------------------

  private async buildVars(moduleId: string): Promise<{
    variables: Record<string, string>;
    inputFiles: Array<{ filePath: string; sha: string }>;
  } | null> {
    switch (moduleId) {
      case 'core/overview':
        return this.buildOverviewVars();
      case 'core/project-structure':
        return this.buildProjectStructureVars();
      case 'core/getting-started':
        return this.buildGettingStartedVars();
      case 'core/configuration':
        return this.buildConfigurationVars();
      case 'core/dependencies':
        return this.buildDependenciesVars();
      case 'core/testing':
        return this.buildTestingVars();
      case 'core/deployment':
        return this.buildDeploymentVars();
      case 'backend/api-reference':
        return this.buildApiReferenceVars();
      case 'backend/database':
        return this.buildDatabaseVars();
      case 'backend/auth':
        return this.buildAuthVars();
      case 'frontend/component-hierarchy':
        return this.buildComponentHierarchyVars();
      case 'frontend/state-management':
        return this.buildStateManagementVars();
      case 'frontend/routing':
        return this.buildRoutingVars();
      case 'core/architecture':
        return this.buildArchitectureVars();
      case 'core/features':
        return this.buildFeaturesVars();
      default:
        return null;
    }
  }

  // ----- core/overview -----
  private async buildOverviewVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    // README
    const readme = this.findFile('README.md', 'readme.md', 'README.rst', 'README');
    if (readme) {
      const content = await this.readFileSafe(readme.filePath);
      if (content) {
        variables['readmeContent'] = truncate(content, 3000);
        inputFiles.push({ filePath: readme.filePath, sha: readme.currentSha });
      }
    }

    // Package manifest
    const manifest = this.findManifest();
    if (manifest) {
      const content = await this.readFileSafe(manifest.filePath);
      if (content) {
        variables['manifestFileName'] = path.basename(manifest.filePath);
        variables['manifestContent'] = content;
        inputFiles.push({ filePath: manifest.filePath, sha: manifest.currentSha });
      }
    }

    // Entry points (from CIG metadata)
    const entryPoints = this.getEntryPointNodes().slice(0, 2);
    const epParts: string[] = [];
    for (const ep of entryPoints) {
      const content = await this.readFileSafe(ep.filePath);
      if (content) {
        epParts.push(`### ${ep.filePath}\n${truncate(content, 750)}`);
        const rf = this.repoFileMap.get(ep.filePath);
        if (rf) inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
      }
    }
    if (epParts.length > 0) {
      variables['entryPointFiles'] = epParts.join('\n\n');
    }

    // Key file summaries — top 5 most-imported files by in-degree
    if (this.fileSummaries.size > 0) {
      const topFiles = this.getFilesByInDegree(5);
      const summaryParts: string[] = [];
      for (const fp of topFiles) {
        const summary = this.fileSummaries.get(fp);
        if (summary) {
          summaryParts.push(`### ${fp}\n${summary}`);
        }
      }
      if (summaryParts.length > 0) {
        variables['keySummaries'] = summaryParts.join('\n\n');
      }
    }

    return { variables, inputFiles };
  }

  // ----- core/project-structure -----
  private async buildProjectStructureVars() {
    const variables: Record<string, string> = {};

    // All file paths (up to 200)
    const paths = this.repoFiles
      .map(f => f.filePath)
      .sort()
      .slice(0, 200);
    variables['filePaths'] = paths.join('\n');

    // Entry points
    const entryPoints = this.getEntryPointNodes();
    if (entryPoints.length > 0) {
      variables['entryPointPaths'] = entryPoints.map(ep => `- ${ep.filePath}`).join('\n');
    }

    // Input files: none (uses file paths only, not content)
    return { variables, inputFiles: [] };
  }

  // ----- core/getting-started -----
  private async buildGettingStartedVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const manifest = this.findManifest();
    if (manifest) {
      const content = await this.readFileSafe(manifest.filePath);
      if (content) {
        variables['manifestFileName'] = path.basename(manifest.filePath);
        variables['manifestContent'] = content;
        inputFiles.push({ filePath: manifest.filePath, sha: manifest.currentSha });
      }
    }

    const envExample = this.findFile('.env.example', '.env.sample');
    if (envExample) {
      const content = await this.readFileSafe(envExample.filePath);
      if (content) {
        variables['envExampleContent'] = content;
        inputFiles.push({ filePath: envExample.filePath, sha: envExample.currentSha });
      }
    }

    const dockerfile = this.findFile('Dockerfile');
    if (dockerfile) {
      const content = await this.readFileSafe(dockerfile.filePath);
      if (content) {
        variables['dockerfileContent'] = content;
        inputFiles.push({ filePath: dockerfile.filePath, sha: dockerfile.currentSha });
      }
    }

    const makefile = this.findFile('Makefile', 'makefile');
    if (makefile) {
      const content = await this.readFileSafe(makefile.filePath);
      if (content) {
        variables['makefileContent'] = content;
        inputFiles.push({ filePath: makefile.filePath, sha: makefile.currentSha });
      }
    }

    return { variables, inputFiles };
  }

  // ----- core/configuration -----
  private async buildConfigurationVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const envExample = this.findFile('.env.example', '.env.sample');
    if (envExample) {
      const content = await this.readFileSafe(envExample.filePath);
      if (content) {
        variables['envExampleContent'] = content;
        inputFiles.push({ filePath: envExample.filePath, sha: envExample.currentSha });
      }
    }

    // Config files — look for common config patterns
    const configFiles = this.repoFiles.filter(f =>
      f.fileType === 'config' &&
      !f.filePath.includes('node_modules') &&
      !path.basename(f.filePath).startsWith('.git'),
    ).slice(0, 3);

    const configParts: string[] = [];
    for (const cf of configFiles) {
      const content = await this.readFileSafe(cf.filePath);
      if (content) {
        configParts.push(`### ${cf.filePath}\n\`\`\`\n${truncate(content, 700)}\n\`\`\``);
        inputFiles.push({ filePath: cf.filePath, sha: cf.currentSha });
      }
    }
    if (configParts.length > 0) {
      variables['configFilesContent'] = configParts.join('\n\n');
    }

    return { variables, inputFiles };
  }

  // ----- core/dependencies -----
  private async buildDependenciesVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const manifest = this.findManifest();
    if (manifest) {
      const content = await this.readFileSafe(manifest.filePath);
      if (content) {
        variables['manifestFileName'] = path.basename(manifest.filePath);
        variables['manifestContent'] = truncate(content, 3000);
        inputFiles.push({ filePath: manifest.filePath, sha: manifest.currentSha });
      }
    }

    return { variables, inputFiles };
  }

  // ----- core/testing -----
  private async buildTestingVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    variables['language'] = this.classifierResult.language;

    // Test config file
    const testConfig = this.findFile(
      'jest.config.ts', 'jest.config.js', 'jest.config.mjs',
      'vitest.config.ts', 'vitest.config.js',
      'pytest.ini',
    );
    if (testConfig) {
      const content = await this.readFileSafe(testConfig.filePath);
      if (content) {
        variables['configFileName'] = path.basename(testConfig.filePath);
        variables['testConfigContent'] = content;
        inputFiles.push({ filePath: testConfig.filePath, sha: testConfig.currentSha });
      }
    }

    // Test scripts from package.json
    const manifest = this.findManifest();
    if (manifest && path.basename(manifest.filePath) === 'package.json') {
      const content = await this.readFileSafe(manifest.filePath);
      if (content) {
        const testScripts = extractTestScripts(content);
        if (testScripts) {
          variables['testScripts'] = testScripts;
          inputFiles.push({ filePath: manifest.filePath, sha: manifest.currentSha });
        }
      }
    }

    // Sample test files (up to 3)
    const testFiles = this.repoFiles
      .filter(f => f.fileType === 'test')
      .slice(0, 3);
    for (let i = 0; i < testFiles.length; i++) {
      const tf = testFiles[i];
      const content = await this.readFileSafe(tf.filePath);
      if (content) {
        variables[`testFile${i + 1}Path`] = tf.filePath;
        variables[`testFile${i + 1}Content`] = truncate(content, 800);
        inputFiles.push({ filePath: tf.filePath, sha: tf.currentSha });
      }
    }

    return { variables, inputFiles };
  }

  // ----- core/deployment -----
  private async buildDeploymentVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const dockerfile = this.findFile('Dockerfile');
    if (dockerfile) {
      const content = await this.readFileSafe(dockerfile.filePath);
      if (content) {
        variables['dockerfileContent'] = content;
        inputFiles.push({ filePath: dockerfile.filePath, sha: dockerfile.currentSha });
      }
    }

    // CI config
    const ciFiles = this.repoFiles.filter(f => f.fileType === 'ci').slice(0, 1);
    if (ciFiles.length > 0) {
      const ci = ciFiles[0];
      const content = await this.readFileSafe(ci.filePath);
      if (content) {
        variables['ciFileName'] = ci.filePath;
        variables['ciContent'] = truncate(content, 2000);
        inputFiles.push({ filePath: ci.filePath, sha: ci.currentSha });
      }
    }

    // Docker Compose
    const compose = this.findFile('docker-compose.yml', 'docker-compose.yaml', 'docker-compose.prod.yml');
    if (compose) {
      const content = await this.readFileSafe(compose.filePath);
      if (content) {
        variables['dockerComposeFileName'] = path.basename(compose.filePath);
        variables['dockerComposeContent'] = content;
        inputFiles.push({ filePath: compose.filePath, sha: compose.currentSha });
      }
    }

    // K8s
    const k8sFiles = this.repoFiles
      .filter(f => f.fileType === 'infra' && (f.filePath.includes('k8s/') || f.filePath.includes('helm/')))
      .slice(0, 3);
    const k8sParts: string[] = [];
    for (const kf of k8sFiles) {
      const content = await this.readFileSafe(kf.filePath);
      if (content) {
        k8sParts.push(`### ${kf.filePath}\n\`\`\`yaml\n${truncate(content, 700)}\n\`\`\``);
        inputFiles.push({ filePath: kf.filePath, sha: kf.currentSha });
      }
    }
    if (k8sParts.length > 0) {
      variables['k8sContent'] = k8sParts.join('\n\n');
    }

    // Build scripts from package.json
    const manifest = this.findManifest();
    if (manifest && path.basename(manifest.filePath) === 'package.json') {
      const content = await this.readFileSafe(manifest.filePath);
      if (content) {
        const buildScripts = extractBuildScripts(content);
        if (buildScripts) {
          variables['buildScripts'] = buildScripts;
          inputFiles.push({ filePath: manifest.filePath, sha: manifest.currentSha });
        }
      }
    }

    return { variables, inputFiles };
  }

  // ----- core/architecture -----
  private async buildArchitectureVars() {
    if (this.fileSummaries.size === 0) return null;

    const variables: Record<string, string> = {};

    const topFiles = this.getFilesByInDegree(20);
    if (topFiles.length === 0) return null;

    const summaryParts: string[] = [];
    for (const fp of topFiles) {
      const summary = this.fileSummaries.get(fp);
      if (summary) {
        summaryParts.push(`### ${fp}\n${summary}`);
      }
    }
    if (summaryParts.length === 0) return null;
    variables['fileSummariesBlock'] = summaryParts.join('\n\n');

    // Build inter-file import graph between the top files
    const topFileSet = new Set(topFiles);
    const nodeToFile = new Map<string, string>();
    for (const n of this.nodes) {
      nodeToFile.set(n.nodeId, n.filePath);
    }

    const graphLines = new Set<string>();
    for (const edge of this.edges) {
      if (edge.edgeType !== 'imports') continue;
      const fromFile = nodeToFile.get(edge.fromNodeId);
      const toFile = nodeToFile.get(edge.toNodeId);
      if (fromFile && toFile && fromFile !== toFile &&
          topFileSet.has(fromFile) && topFileSet.has(toFile)) {
        graphLines.add(`${fromFile} → ${toFile}`);
        if (graphLines.size >= 100) break;
      }
    }
    if (graphLines.size > 0) {
      variables['importGraphBlock'] = [...graphLines].join('\n');
    }

    // Track the top files as inputs so staleness propagates when their summaries change
    const inputFiles = topFiles
      .map(fp => this.repoFileMap.get(fp))
      .filter((rf): rf is RepoFile => rf !== undefined)
      .map(rf => ({ filePath: rf.filePath, sha: rf.currentSha }));

    return { variables, inputFiles };
  }

  // ----- core/features -----
  private async buildFeaturesVars() {
    const FEATURE_PATTERNS = [
      'service', 'handler', 'controller', 'provider',
      'manager', 'repository', 'use-case', 'usecase',
    ];

    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const inDegreeRanked = this.getFilesByInDegree(200);
    const byPattern = this.repoFiles.filter(f =>
      f.fileType === 'source' &&
      FEATURE_PATTERNS.some(p => f.filePath.toLowerCase().includes(p)),
    );

    if (byPattern.length === 0) return null;

    const inDegreeIndex = new Map(inDegreeRanked.map((fp, i) => [fp, i]));
    byPattern.sort((a, b) => {
      const ai = inDegreeIndex.get(a.filePath) ?? 9999;
      const bi = inDegreeIndex.get(b.filePath) ?? 9999;
      return ai - bi;
    });

    const topFeatureFiles = byPattern.slice(0, 25);

    const summaryParts: string[] = [];
    for (const rf of topFeatureFiles) {
      const summary = this.fileSummaries.get(rf.filePath);
      if (summary) {
        summaryParts.push(`### ${rf.filePath}\n${summary}`);
        inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
      } else {
        const content = await this.readFileSafe(rf.filePath);
        if (content) {
          summaryParts.push(`### ${rf.filePath}\n${content.slice(0, 500)}`);
          inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
        }
      }
    }

    if (summaryParts.length === 0) return null;

    return {
      variables: { featureSummariesBlock: summaryParts.join('\n\n') },
      inputFiles,
    };
  }

  // ----- backend/api-reference -----
  private async buildApiReferenceVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    variables['language'] = this.classifierResult.language;

    // Determine backend framework
    const backendFrameworks = ['express', 'fastapi', 'nestjs', 'gin', 'echo', 'fastify', 'flask', 'django', 'koa', 'hapi'];
    const framework = this.classifierResult.frameworks.find(f =>
      backendFrameworks.includes(f.toLowerCase()),
    ) || this.classifierResult.frameworks[0] || 'unknown';
    variables['framework'] = framework;

    // Routes from CIG
    const routeNodes = this.nodes.filter(n => n.symbolType === 'route');
    if (routeNodes.length > 0) {
      const routeLines = routeNodes.map(n => {
        const meta = n.metadata as Record<string, unknown> | null;
        const method = (meta?.['method'] as string) || 'GET';
        const routePath = (meta?.['path'] as string) || n.symbolName;
        return `${method.toUpperCase()} ${routePath} — handler: ${n.symbolName} (${n.filePath}:${n.startLine})`;
      });
      variables['routesList'] = routeLines.join('\n');
    }

    // Route handler files — unique files from route nodes
    const routeFilePaths = [...new Set(routeNodes.map(n => n.filePath))].slice(0, 2);
    for (let i = 0; i < routeFilePaths.length; i++) {
      const fp = routeFilePaths[i];
      const content = await this.readFileSafe(fp);
      if (content) {
        variables[`routeFile${i + 1}Path`] = fp;
        variables[`routeFile${i + 1}Content`] = truncate(content, 2000);
        const rf = this.repoFileMap.get(fp);
        if (rf) inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
      }
    }

    // Skip if no routes were found at all — an empty API reference is misleading.
    if (!variables['routesList'] && inputFiles.length === 0) return null;

    return { variables, inputFiles };
  }

  // ----- backend/database -----
  private async buildDatabaseVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    const orm = this.classifierResult.detectedSignals['database'] || 'unknown';
    variables['orm'] = orm;
    variables['database'] = inferDatabase(orm);

    // Schema files from CIG
    const schemaNodes = this.nodes.filter(n => n.symbolType === 'schema');
    const schemaFiles = [...new Set(schemaNodes.map(n => n.filePath))].slice(0, 1);
    if (schemaFiles.length > 0) {
      const fp = schemaFiles[0];
      const content = await this.readFileSafe(fp);
      if (content) {
        variables['schemaFileName'] = fp;
        variables['schemaContent'] = truncate(content, 4000);
        const rf = this.repoFileMap.get(fp);
        if (rf) inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
      }
    }

    // If no schema nodes, look for common schema files
    if (!variables['schemaContent']) {
      const schemaFile = this.findFile(
        'prisma/schema.prisma', 'schema.prisma',
        'src/models/index.ts', 'src/entities/index.ts',
      );
      if (schemaFile) {
        const content = await this.readFileSafe(schemaFile.filePath);
        if (content) {
          variables['schemaFileName'] = schemaFile.filePath;
          variables['schemaContent'] = truncate(content, 4000);
          inputFiles.push({ filePath: schemaFile.filePath, sha: schemaFile.currentSha });
        }
      }
    }

    // Migration files
    const migrationFiles = this.repoFiles
      .filter(f =>
        f.filePath.includes('migration') ||
        f.filePath.includes('migrate'),
      )
      .slice(-2); // Most recent 2
    const migParts: string[] = [];
    for (const mf of migrationFiles) {
      const content = await this.readFileSafe(mf.filePath);
      if (content) {
        migParts.push(`### ${mf.filePath}\n\`\`\`\n${truncate(content, 750)}\n\`\`\``);
        inputFiles.push({ filePath: mf.filePath, sha: mf.currentSha });
      }
    }
    if (migParts.length > 0) {
      variables['migrationsContent'] = migParts.join('\n\n');
    }

    return { variables, inputFiles };
  }

  // ----- backend/auth -----
  private async buildAuthVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    variables['language'] = this.classifierResult.language;
    variables['authLibrary'] = this.classifierResult.detectedSignals['auth'] || 'unknown';

    // Find auth middleware files
    const authPatterns = ['auth', 'middleware/auth', 'guards', 'passport'];
    const authFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      authPatterns.some(p => f.filePath.toLowerCase().includes(p)),
    );
    if (authFile) {
      const content = await this.readFileSafe(authFile.filePath);
      if (content) {
        variables['authMiddlewareFile'] = authFile.filePath;
        variables['authMiddlewareContent'] = truncate(content, 2000);
        inputFiles.push({ filePath: authFile.filePath, sha: authFile.currentSha });
      }
    }

    // Token files
    const tokenFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      (f.filePath.toLowerCase().includes('token') ||
       f.filePath.toLowerCase().includes('jwt') ||
       f.filePath.toLowerCase().includes('session')),
    );
    if (tokenFile) {
      const content = await this.readFileSafe(tokenFile.filePath);
      if (content) {
        variables['tokenFile'] = tokenFile.filePath;
        variables['tokenFileContent'] = truncate(content, 1500);
        inputFiles.push({ filePath: tokenFile.filePath, sha: tokenFile.currentSha });
      }
    }

    // Auth route files
    const authRouteFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      f.filePath.toLowerCase().includes('auth') &&
      (f.filePath.toLowerCase().includes('route') || f.filePath.toLowerCase().includes('controller')),
    );
    if (authRouteFile) {
      const content = await this.readFileSafe(authRouteFile.filePath);
      if (content) {
        variables['authRoutesFile'] = authRouteFile.filePath;
        variables['authRoutesContent'] = truncate(content, 1500);
        inputFiles.push({ filePath: authRouteFile.filePath, sha: authRouteFile.currentSha });
      }
    }

    // Skip the module entirely if no auth-related files were found — calling
    // the LLM with no code causes it to respond as a help assistant ("please
    // provide code") rather than as a doc generator.
    if (inputFiles.length === 0) return null;

    return { variables, inputFiles };
  }

  // ----- frontend/component-hierarchy -----
  private async buildComponentHierarchyVars() {
    const variables: Record<string, string> = {};

    const frontendFrameworks = ['react', 'vue', 'angular', 'svelte'];
    variables['framework'] = this.classifierResult.frameworks.find(f =>
      frontendFrameworks.includes(f.toLowerCase()),
    ) || 'react';

    // Component files (by extension)
    const componentExts = ['.tsx', '.jsx', '.vue', '.svelte'];
    const componentFiles = this.repoFiles
      .filter(f => componentExts.some(ext => f.filePath.endsWith(ext)))
      .slice(0, 100);

    if (componentFiles.length > 0) {
      variables['componentFiles'] = componentFiles
        .map(f => f.filePath)
        .sort()
        .join('\n');
    }

    // Component import graph from CIG edges
    const componentPathSet = new Set(componentFiles.map(f => f.filePath));
    const importEdges = this.edges.filter(e => e.edgeType === 'imports');

    // Map node IDs to file paths
    const nodeToFile = new Map<string, string>();
    for (const n of this.nodes) {
      nodeToFile.set(n.nodeId, n.filePath);
    }

    const graphLines: string[] = [];
    for (const edge of importEdges) {
      const fromFile = nodeToFile.get(edge.fromNodeId);
      const toFile = nodeToFile.get(edge.toNodeId);
      if (fromFile && toFile && componentPathSet.has(fromFile) && componentPathSet.has(toFile)) {
        const fromName = path.basename(fromFile, path.extname(fromFile));
        const toName = path.basename(toFile, path.extname(toFile));
        graphLines.push(`${fromName} → ${toName}`);
      }
    }

    if (graphLines.length > 0) {
      // Deduplicate and cap at 150 edges
      variables['componentImportGraph'] = [...new Set(graphLines)].slice(0, 150).join('\n');
    }

    // No file content needed — pure CIG graph
    return { variables, inputFiles: [] };
  }

  // ----- frontend/state-management -----
  private async buildStateManagementVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    variables['language'] = this.classifierResult.language;
    variables['stateLibrary'] = this.classifierResult.detectedSignals['state_management'] || 'unknown';

    // Store files
    const storePatterns = ['store', 'stores', 'slice', 'slices', 'atom'];
    const storeFiles = this.repoFiles
      .filter(f =>
        f.fileType === 'source' &&
        storePatterns.some(p => f.filePath.toLowerCase().includes(p)),
      )
      .slice(0, 3);

    for (let i = 0; i < storeFiles.length; i++) {
      const sf = storeFiles[i];
      const content = await this.readFileSafe(sf.filePath);
      if (content) {
        variables[`storeFile${i + 1}Path`] = sf.filePath;
        variables[`storeFile${i + 1}Content`] = truncate(content, 2000);
        inputFiles.push({ filePath: sf.filePath, sha: sf.currentSha });
      }
    }

    return { variables, inputFiles };
  }

  // ----- frontend/routing -----
  private async buildRoutingVars() {
    const variables: Record<string, string> = {};
    const inputFiles: Array<{ filePath: string; sha: string }> = [];

    variables['language'] = this.classifierResult.language;

    // Router library
    const routerLibs = ['react-router', 'react-router-dom', 'vue-router', 'next', 'next.js',
      'tanstack-router', 'angular-router', 'svelte-kit'];
    variables['routerLibrary'] = this.classifierResult.frameworks.find(f =>
      routerLibs.some(rl => f.toLowerCase().includes(rl)),
    ) || 'unknown';

    // Router config file
    const routerPatterns = ['router', 'routes', 'App.tsx', 'App.jsx'];
    const routerFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      routerPatterns.some(p => path.basename(f.filePath).toLowerCase().includes(p.toLowerCase())),
    );
    if (routerFile) {
      const content = await this.readFileSafe(routerFile.filePath);
      if (content) {
        variables['routerFile'] = routerFile.filePath;
        variables['routerContent'] = truncate(content, 3000);
        inputFiles.push({ filePath: routerFile.filePath, sha: routerFile.currentSha });
      }
    }

    // Guard file
    const guardFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      (f.filePath.toLowerCase().includes('guard') || f.filePath.toLowerCase().includes('protected')),
    );
    if (guardFile) {
      const content = await this.readFileSafe(guardFile.filePath);
      if (content) {
        variables['guardFile'] = guardFile.filePath;
        variables['guardContent'] = truncate(content, 1000);
        inputFiles.push({ filePath: guardFile.filePath, sha: guardFile.currentSha });
      }
    }

    // Layout file
    const layoutFile = this.repoFiles.find(f =>
      f.fileType === 'source' &&
      f.filePath.toLowerCase().includes('layout'),
    );
    if (layoutFile) {
      const content = await this.readFileSafe(layoutFile.filePath);
      if (content) {
        variables['layoutFile'] = layoutFile.filePath;
        variables['layoutContent'] = truncate(content, 1000);
        inputFiles.push({ filePath: layoutFile.filePath, sha: layoutFile.currentSha });
      }
    }

    return { variables, inputFiles };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Lazy-built map of filePath → RepoFile for O(1) lookups. */
  private _repoFileMap: Map<string, RepoFile> | undefined;
  private get repoFileMap(): Map<string, RepoFile> {
    if (!this._repoFileMap) {
      this._repoFileMap = new Map(this.repoFiles.map(f => [f.filePath, f]));
    }
    return this._repoFileMap;
  }

  /** Find a file by exact basename or path match. */
  private findFile(...candidates: string[]): RepoFile | undefined {
    for (const candidate of candidates) {
      // Try exact path match first
      const exact = this.repoFileMap.get(candidate);
      if (exact) return exact;

      // Try basename match
      const byName = this.repoFiles.find(
        f => path.basename(f.filePath).toLowerCase() === candidate.toLowerCase(),
      );
      if (byName) return byName;
    }
    return undefined;
  }

  /** Find the first package manifest file. */
  private findManifest(): RepoFile | undefined {
    return this.findFile(
      'package.json',
      'pyproject.toml',
      'go.mod',
      'Cargo.toml',
      'pom.xml',
      'build.gradle',
      'requirements.txt',
    );
  }

  /** Get entry point nodes from CIG (marked via metadata). */
  private getEntryPointNodes(): CIGNode[] {
    return this.nodes
      .filter(n =>
        n.symbolName === '<module>' &&
        n.metadata?.['isEntryPoint'] === true,
      )
      .sort((a, b) => {
        const scoreA = (a.metadata?.['entryPointScore'] as number) || 0;
        const scoreB = (b.metadata?.['entryPointScore'] as number) || 0;
        return scoreB - scoreA;
      });
  }

  /**
   * Return the top N source file paths ranked by import in-degree (most imported first).
   * Only considers CIG edges of type 'imports'. Config/schema/test files are excluded.
   */
  private getFilesByInDegree(topN: number): string[] {
    // Build a node index: nodeId → filePath
    const nodeFilePath = new Map<string, string>();
    for (const node of this.nodes) {
      nodeFilePath.set(node.nodeId, node.filePath);
    }

    // Build a set of source-file paths (exclude config, test, etc.)
    const sourceFilePaths = new Set(
      this.repoFiles
        .filter(f => f.fileType === 'source')
        .map(f => f.filePath),
    );

    // Count distinct source files that import each destination file
    const inDegree = new Map<string, Set<string>>();
    for (const edge of this.edges) {
      if (edge.edgeType !== 'imports') continue;
      const toFilePath = nodeFilePath.get(edge.toNodeId);
      const fromFilePath = nodeFilePath.get(edge.fromNodeId);
      if (!toFilePath || !fromFilePath) continue;
      if (!sourceFilePaths.has(toFilePath)) continue;

      const importers = inDegree.get(toFilePath) ?? new Set<string>();
      importers.add(fromFilePath);
      inDegree.set(toFilePath, importers);
    }

    // Sort descending by importer count
    return [...inDegree.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, topN)
      .map(([fp]) => fp);
  }

  /** Read a file from the clone dir. Throws on failure. Guards against path traversal. */
  private async readFile(filePath: string): Promise<string> {
    const resolved = path.resolve(this.cloneDir, filePath);
    if (!resolved.startsWith(path.resolve(this.cloneDir) + path.sep)) {
      throw new Error(`Path traversal attempt: ${filePath}`);
    }
    return fs.readFile(resolved, 'utf-8');
  }

  /** Read a file from the clone dir. Returns null on failure. */
  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await this.readFile(filePath);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility — compute composite SHA for multiple input files
// ---------------------------------------------------------------------------

export function computeInputSha(
  inputFiles: Array<{ filePath: string; sha: string }>,
): string {
  if (inputFiles.length === 0) return 'empty';

  const sorted = [...inputFiles].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const payload = sorted.map(f => `${f.filePath}:${f.sha}`).join('|');
  return createHash('sha256').update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
}

function inferDatabase(orm: string): string {
  const mapping: Record<string, string> = {
    prisma: 'PostgreSQL',
    typeorm: 'PostgreSQL',
    sequelize: 'PostgreSQL',
    mongoose: 'MongoDB',
    drizzle: 'PostgreSQL',
    sqlalchemy: 'PostgreSQL',
  };
  return mapping[orm.toLowerCase()] || 'unknown';
}

function extractTestScripts(packageJsonContent: string): string | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg.scripts || {};
    const testScripts: Record<string, string> = {};
    for (const [key, val] of Object.entries(scripts)) {
      if (key.includes('test') || key.includes('jest') || key.includes('vitest')) {
        testScripts[key] = val as string;
      }
    }
    return Object.keys(testScripts).length > 0
      ? JSON.stringify(testScripts, null, 2)
      : null;
  } catch {
    return null;
  }
}

function extractBuildScripts(packageJsonContent: string): string | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg.scripts || {};
    const buildScripts: Record<string, string> = {};
    for (const [key, val] of Object.entries(scripts)) {
      if (key.includes('build') || key.includes('start') || key.includes('deploy')) {
        buildScripts[key] = val as string;
      }
    }
    return Object.keys(buildScripts).length > 0
      ? JSON.stringify(buildScripts, null, 2)
      : null;
  } catch {
    return null;
  }
}
