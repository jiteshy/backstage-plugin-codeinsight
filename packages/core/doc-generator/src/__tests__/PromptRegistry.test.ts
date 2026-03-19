import { PromptRegistry } from '../PromptRegistry';

describe('PromptRegistry', () => {
  const registry = new PromptRegistry();

  it('returns definitions for all core modules', () => {
    const coreModules = [
      'core/overview',
      'core/project-structure',
      'core/getting-started',
      'core/configuration',
      'core/dependencies',
      'core/testing',
      'core/deployment',
    ];

    for (const id of coreModules) {
      const def = registry.getDefinition(id);
      expect(def).not.toBeNull();
      expect(def!.moduleId).toBe(id);
      expect(def!.systemPrompt.length).toBeGreaterThan(100);
    }
  });

  it('returns definitions for backend modules', () => {
    const backendModules = ['backend/api-reference', 'backend/database', 'backend/auth'];

    for (const id of backendModules) {
      const def = registry.getDefinition(id);
      expect(def).not.toBeNull();
      expect(def!.systemPrompt).toContain('documentation writer');
    }
  });

  it('returns definitions for frontend modules', () => {
    const frontendModules = [
      'frontend/component-hierarchy',
      'frontend/state-management',
      'frontend/routing',
    ];

    for (const id of frontendModules) {
      const def = registry.getDefinition(id);
      expect(def).not.toBeNull();
    }
  });

  it('returns null for unknown modules', () => {
    expect(registry.getDefinition('nonexistent/module')).toBeNull();
    expect(registry.getDefinition('')).toBeNull();
  });

  it('builds user prompts from variables', () => {
    const def = registry.getDefinition('core/overview')!;
    const prompt = def.buildUserPrompt({
      readmeContent: '# My Project\nA cool project.',
      manifestFileName: 'package.json',
      manifestContent: '{"name": "my-project"}',
    });

    expect(prompt).toContain('# My Project');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('Generate the Overview section');
  });

  it('builds project-structure prompt with file paths', () => {
    const def = registry.getDefinition('core/project-structure')!;
    const prompt = def.buildUserPrompt({
      filePaths: 'src/index.ts\nsrc/server.ts\npackage.json',
      entryPointPaths: '- src/index.ts',
    });

    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('Entry Points');
    expect(prompt).toContain('Generate the Project Structure section');
  });

  it('builds api-reference prompt with routes', () => {
    const def = registry.getDefinition('backend/api-reference')!;
    const prompt = def.buildUserPrompt({
      routesList: 'GET /users — handler: getUsers (src/routes/users.ts:5)',
      framework: 'express',
      language: 'typescript',
      routeFile1Path: 'src/routes/users.ts',
      routeFile1Content: 'router.get("/users", getUsers);',
    });

    expect(prompt).toContain('GET /users');
    expect(prompt).toContain('express');
    expect(prompt).toContain('Generate the API Reference section');
  });

  it('omits empty blocks in user prompts', () => {
    const def = registry.getDefinition('core/getting-started')!;
    const prompt = def.buildUserPrompt({
      manifestFileName: 'package.json',
      manifestContent: '{"name": "test"}',
      // No envExampleContent, dockerfileContent, makefileContent
    });

    expect(prompt).toContain('package.json');
    expect(prompt).not.toContain('Environment Variables');
    expect(prompt).not.toContain('Dockerfile');
    expect(prompt).toContain('Generate the Getting Started section');
  });

  it('lists all supported modules', () => {
    const supported = registry.getSupportedModules();
    expect(supported.length).toBeGreaterThanOrEqual(13);
    expect(supported).toContain('core/overview');
    expect(supported).toContain('backend/api-reference');
    expect(supported).toContain('frontend/component-hierarchy');
  });
});
