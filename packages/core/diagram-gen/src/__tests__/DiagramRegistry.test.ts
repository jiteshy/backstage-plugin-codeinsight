import { DiagramRegistry } from '../DiagramRegistry';
import type { DiagramModule } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModule(
  id: string,
  triggersOn: readonly string[] = [],
  llmNeeded = false,
): DiagramModule {
  return {
    id,
    requires: ['nodes', 'edges'],
    triggersOn,
    llmNeeded,
    generate: jest.fn().mockResolvedValue(null),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagramRegistry', () => {
  let registry: DiagramRegistry;

  beforeEach(() => {
    registry = new DiagramRegistry();
  });

  // -------------------------------------------------------------------------
  // register()
  // -------------------------------------------------------------------------

  describe('register()', () => {
    it('registers a module and makes it retrievable via getModule()', () => {
      const mod = makeModule('test/module');
      registry.register(mod);
      expect(registry.getModule('test/module')).toBe(mod);
    });

    it('registers multiple modules without conflict', () => {
      const a = makeModule('mod/a');
      const b = makeModule('mod/b');
      registry.register(a);
      registry.register(b);
      expect(registry.getModule('mod/a')).toBe(a);
      expect(registry.getModule('mod/b')).toBe(b);
    });

    it('throws when registering a duplicate module ID', () => {
      const mod = makeModule('duplicate/module');
      registry.register(mod);
      expect(() => registry.register(mod)).toThrow(
        "DiagramModule 'duplicate/module' is already registered",
      );
    });

    it('throws on duplicate even if it is a different object with the same ID', () => {
      registry.register(makeModule('shared/id'));
      expect(() => registry.register(makeModule('shared/id'))).toThrow(
        "DiagramModule 'shared/id' is already registered",
      );
    });
  });

  // -------------------------------------------------------------------------
  // getModule()
  // -------------------------------------------------------------------------

  describe('getModule()', () => {
    it('returns undefined for an unregistered ID', () => {
      expect(registry.getModule('does/not/exist')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // selectModules()
  // -------------------------------------------------------------------------

  describe('selectModules()', () => {
    it('always includes modules with an empty triggersOn array (always-on)', () => {
      const alwaysOn = makeModule('always/on', []);
      registry.register(alwaysOn);
      const selected = registry.selectModules({});
      expect(selected).toContain(alwaysOn);
    });

    it('returns always-on module even when detectedSignals is empty', () => {
      registry.register(makeModule('universal/dep-graph', []));
      const selected = registry.selectModules({});
      expect(selected).toHaveLength(1);
    });

    it('includes a signal-gated module when its trigger is satisfied', () => {
      const ormMod = makeModule('universal/er-diagram', ['orm:prisma']);
      registry.register(ormMod);
      const selected = registry.selectModules({ orm: 'prisma' });
      expect(selected).toContain(ormMod);
    });

    it('excludes a signal-gated module when no matching signal is present', () => {
      const ormMod = makeModule('universal/er-diagram', ['orm:prisma']);
      registry.register(ormMod);
      const selected = registry.selectModules({ framework: 'react' });
      expect(selected).not.toContain(ormMod);
    });

    it('returns empty array when no modules match any signal', () => {
      registry.register(makeModule('gated/a', ['orm:prisma']));
      registry.register(makeModule('gated/b', ['framework:vue']));
      const selected = registry.selectModules({ framework: 'react' });
      expect(selected).toHaveLength(0);
    });

    it('mixes always-on and signal-gated modules in the result', () => {
      const always = makeModule('universal/dep-graph', []);
      const gated = makeModule('universal/er-diagram', ['orm:prisma']);
      const notTriggered = makeModule('frontend/component', ['framework:react']);
      registry.register(always);
      registry.register(gated);
      registry.register(notTriggered);
      const selected = registry.selectModules({ orm: 'prisma' });
      expect(selected).toContain(always);
      expect(selected).toContain(gated);
      expect(selected).not.toContain(notTriggered);
    });

    it('activates a module if any one of its multiple triggers matches', () => {
      const multiTrigger = makeModule('frontend/component', [
        'framework:react',
        'framework:vue',
        'framework:angular',
      ]);
      registry.register(multiTrigger);
      expect(registry.selectModules({ framework: 'vue' })).toContain(multiTrigger);
    });

    it('preserves registration order in returned array', () => {
      const a = makeModule('mod/a', []);
      const b = makeModule('mod/b', []);
      const c = makeModule('mod/c', []);
      registry.register(a);
      registry.register(b);
      registry.register(c);
      const selected = registry.selectModules({});
      expect(selected).toEqual([a, b, c]);
    });
  });

  // -------------------------------------------------------------------------
  // getAllModules()
  // -------------------------------------------------------------------------

  describe('getAllModules()', () => {
    it('returns all registered modules', () => {
      const a = makeModule('mod/a');
      const b = makeModule('mod/b');
      registry.register(a);
      registry.register(b);
      expect(registry.getAllModules()).toEqual([a, b]);
    });

    it('returns empty array when no modules are registered', () => {
      expect(registry.getAllModules()).toHaveLength(0);
    });
  });
});
