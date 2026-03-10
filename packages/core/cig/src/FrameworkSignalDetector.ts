// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedSignals {
  /** Web frameworks detected (e.g. react, express, next, fastify). */
  frameworks: DetectedDependency[];
  /** ORM / database libraries detected (e.g. prisma, typeorm, sequelize). */
  orms: DetectedDependency[];
  /** Test frameworks detected (e.g. jest, vitest, mocha, pytest). */
  testFrameworks: DetectedDependency[];
  /** Auth libraries detected (e.g. passport, next-auth, jsonwebtoken). */
  authLibraries: DetectedDependency[];
  /** Build tools and bundlers detected (e.g. webpack, vite, esbuild). */
  buildTools: DetectedDependency[];
  /** Raw package.json metadata extracted during analysis. */
  packageMeta: PackageMeta | null;
}

export interface DetectedDependency {
  /** npm package name that triggered the match. */
  name: string;
  /** Semver range from package.json. */
  version: string;
  /** Whether it was found in devDependencies (vs dependencies/peerDependencies). */
  isDev: boolean;
  /** Canonical category label for this dependency. */
  category: string;
}

export interface PackageMeta {
  /** Package name from package.json. */
  name?: string;
  /** Package version from package.json. */
  version?: string;
  /** Whether it declares a "main" or "module" entry. */
  hasEntryPoint: boolean;
  /** Whether it has a "scripts" section with a "start" command. */
  hasStartScript: boolean;
  /** Whether it has TypeScript as a dependency (direct or dev). */
  usesTypeScript: boolean;
}

// ---------------------------------------------------------------------------
// Signal rules — maps npm package names to categories
// ---------------------------------------------------------------------------

interface SignalRule {
  category: string;
}

const FRAMEWORK_RULES: Record<string, SignalRule> = {
  'react': { category: 'react' },
  'react-dom': { category: 'react' },
  'next': { category: 'next' },
  'express': { category: 'express' },
  'fastify': { category: 'fastify' },
  'koa': { category: 'koa' },
  'hapi': { category: 'hapi' },
  '@hapi/hapi': { category: 'hapi' },
  '@nestjs/core': { category: 'nestjs' },
  '@nestjs/common': { category: 'nestjs' },
  'vue': { category: 'vue' },
  'nuxt': { category: 'nuxt' },
  'svelte': { category: 'svelte' },
  '@sveltejs/kit': { category: 'sveltekit' },
  'angular': { category: 'angular' },
  '@angular/core': { category: 'angular' },
  'remix': { category: 'remix' },
  '@remix-run/node': { category: 'remix' },
  '@remix-run/react': { category: 'remix' },
  'gatsby': { category: 'gatsby' },
  'astro': { category: 'astro' },
};

const ORM_RULES: Record<string, SignalRule> = {
  'prisma': { category: 'prisma' },
  '@prisma/client': { category: 'prisma' },
  'typeorm': { category: 'typeorm' },
  'sequelize': { category: 'sequelize' },
  'knex': { category: 'knex' },
  'drizzle-orm': { category: 'drizzle' },
  'mongoose': { category: 'mongoose' },
  'mikro-orm': { category: 'mikro-orm' },
  '@mikro-orm/core': { category: 'mikro-orm' },
  'objection': { category: 'objection' },
  'pg': { category: 'pg' },
  'mysql2': { category: 'mysql' },
  'better-sqlite3': { category: 'sqlite' },
};

const TEST_FRAMEWORK_RULES: Record<string, SignalRule> = {
  'jest': { category: 'jest' },
  'vitest': { category: 'vitest' },
  'mocha': { category: 'mocha' },
  'jasmine': { category: 'jasmine' },
  'ava': { category: 'ava' },
  'tap': { category: 'tap' },
  '@testing-library/react': { category: 'testing-library' },
  '@testing-library/jest-dom': { category: 'testing-library' },
  'cypress': { category: 'cypress' },
  'playwright': { category: 'playwright' },
  '@playwright/test': { category: 'playwright' },
  'supertest': { category: 'supertest' },
};

const AUTH_RULES: Record<string, SignalRule> = {
  'passport': { category: 'passport' },
  'next-auth': { category: 'next-auth' },
  '@auth/core': { category: 'authjs' },
  'jsonwebtoken': { category: 'jwt' },
  'jose': { category: 'jose' },
  'bcrypt': { category: 'bcrypt' },
  'bcryptjs': { category: 'bcrypt' },
  'express-session': { category: 'express-session' },
  'oauth2-server': { category: 'oauth2' },
  'keycloak-connect': { category: 'keycloak' },
  '@clerk/nextjs': { category: 'clerk' },
  'firebase-admin': { category: 'firebase-auth' },
};

const BUILD_TOOL_RULES: Record<string, SignalRule> = {
  'webpack': { category: 'webpack' },
  'vite': { category: 'vite' },
  'esbuild': { category: 'esbuild' },
  'rollup': { category: 'rollup' },
  'parcel': { category: 'parcel' },
  'turbo': { category: 'turbo' },
  'tsup': { category: 'tsup' },
  'swc': { category: 'swc' },
  '@swc/core': { category: 'swc' },
};

// ---------------------------------------------------------------------------
// FrameworkSignalDetector
// ---------------------------------------------------------------------------

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export class FrameworkSignalDetector {
  /**
   * Analyse one or more `package.json` contents and return detected signals.
   * Accepts raw JSON strings; invalid JSON is silently skipped.
   */
  detect(packageJsonContents: string[]): DetectedSignals {
    const merged = this.mergePackageJsons(packageJsonContents);

    if (!merged) {
      return this.emptySignals();
    }

    const { deps, devDeps, peerDeps, meta } = merged;

    // Combine all dependency maps with isDev flag
    const allDeps: Array<{ name: string; version: string; isDev: boolean }> = [];

    for (const [name, version] of deps) {
      allDeps.push({ name, version, isDev: false });
    }
    for (const [name, version] of peerDeps) {
      // Don't duplicate if already in deps
      if (!deps.has(name)) {
        allDeps.push({ name, version, isDev: false });
      }
    }
    for (const [name, version] of devDeps) {
      // Don't duplicate if already in deps or peerDeps
      if (!deps.has(name) && !peerDeps.has(name)) {
        allDeps.push({ name, version, isDev: true });
      }
    }

    return {
      frameworks: this.matchRules(allDeps, FRAMEWORK_RULES),
      orms: this.matchRules(allDeps, ORM_RULES),
      testFrameworks: this.matchRules(allDeps, TEST_FRAMEWORK_RULES),
      authLibraries: this.matchRules(allDeps, AUTH_RULES),
      buildTools: this.matchRules(allDeps, BUILD_TOOL_RULES),
      packageMeta: meta,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private mergePackageJsons(
    contents: string[],
  ): {
    deps: Map<string, string>;
    devDeps: Map<string, string>;
    peerDeps: Map<string, string>;
    meta: PackageMeta;
  } | null {
    const deps = new Map<string, string>();
    const devDeps = new Map<string, string>();
    const peerDeps = new Map<string, string>();
    let primaryPkg: PackageJson | null = null;
    let parsed = 0;

    for (const content of contents) {
      let pkg: PackageJson;
      try {
        pkg = JSON.parse(content) as PackageJson;
      } catch {
        continue;
      }

      if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
        continue;
      }

      parsed++;

      // First valid package.json is treated as primary (for meta)
      if (!primaryPkg) {
        primaryPkg = pkg;
      }

      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          if (typeof version === 'string') deps.set(name, version);
        }
      }
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          if (typeof version === 'string') devDeps.set(name, version);
        }
      }
      if (pkg.peerDependencies) {
        for (const [name, version] of Object.entries(pkg.peerDependencies)) {
          if (typeof version === 'string') peerDeps.set(name, version);
        }
      }
    }

    if (parsed === 0) return null;

    const usesTypeScript =
      deps.has('typescript') || devDeps.has('typescript') || peerDeps.has('typescript');

    const meta: PackageMeta = {
      name: primaryPkg?.name,
      version: primaryPkg?.version,
      hasEntryPoint: !!(primaryPkg?.main || primaryPkg?.module),
      hasStartScript: !!primaryPkg?.scripts?.start,
      usesTypeScript,
    };

    return { deps, devDeps, peerDeps, meta };
  }

  private matchRules(
    allDeps: Array<{ name: string; version: string; isDev: boolean }>,
    rules: Record<string, SignalRule>,
  ): DetectedDependency[] {
    const results: DetectedDependency[] = [];
    const seen = new Set<string>(); // avoid duplicates by package name

    for (const dep of allDeps) {
      const rule = rules[dep.name];
      if (rule && !seen.has(dep.name)) {
        seen.add(dep.name);
        results.push({
          name: dep.name,
          version: dep.version,
          isDev: dep.isDev,
          category: rule.category,
        });
      }
    }

    return results;
  }

  private emptySignals(): DetectedSignals {
    return {
      frameworks: [],
      orms: [],
      testFrameworks: [],
      authLibraries: [],
      buildTools: [],
      packageMeta: null,
    };
  }
}
