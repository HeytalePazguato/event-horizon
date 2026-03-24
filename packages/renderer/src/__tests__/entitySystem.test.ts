/**
 * EntitySystem base class tests.
 * Phase H — Test Coverage.
 */

import { describe, it, expect } from 'vitest';
import { EntitySystem } from '../systems/EntitySystem.js';
import type { Entity, UpdateContext } from '../systems/EntitySystem.js';

/** Minimal mock entity for testing pure logic (no PixiJS container needed). */
class MockEntity implements Entity {
  id: string;
  container: any;
  updateCount = 0;
  destroyed = false;
  lastDt = 0;

  constructor(id: string) {
    this.id = id;
    this.container = {};
  }

  update(dt: number, _context: UpdateContext): void {
    this.updateCount++;
    this.lastDt = dt;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function makeContext(overrides?: Partial<UpdateContext>): UpdateContext {
  return {
    dt: 16,
    width: 800,
    height: 600,
    centerX: 400,
    centerY: 300,
    animationSpeed: 1,
    ...overrides,
  };
}

// ── EntitySystem ────────────────────────────────────────────────────────────

describe('EntitySystem', () => {
  it('starts empty', () => {
    const system = new EntitySystem<MockEntity>();
    expect(system.size).toBe(0);
    expect(system.has('a')).toBe(false);
    expect(system.get('a')).toBeUndefined();
  });

  it('adds an entity and retrieves it', () => {
    const system = new EntitySystem<MockEntity>();
    const entity = new MockEntity('a');
    system.add(entity);
    expect(system.size).toBe(1);
    expect(system.has('a')).toBe(true);
    expect(system.get('a')).toBe(entity);
  });

  it('replaces an existing entity with the same id and destroys the old one', () => {
    const system = new EntitySystem<MockEntity>();
    const first = new MockEntity('a');
    const second = new MockEntity('a');
    system.add(first);
    system.add(second);
    expect(system.size).toBe(1);
    expect(system.get('a')).toBe(second);
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(false);
  });

  it('removes an entity by id and destroys it', () => {
    const system = new EntitySystem<MockEntity>();
    const entity = new MockEntity('a');
    system.add(entity);
    system.remove('a');
    expect(system.size).toBe(0);
    expect(system.has('a')).toBe(false);
    expect(entity.destroyed).toBe(true);
  });

  it('remove is a no-op for non-existent id', () => {
    const system = new EntitySystem<MockEntity>();
    system.remove('nonexistent');
    expect(system.size).toBe(0);
  });

  it('update calls update on every entity', () => {
    const system = new EntitySystem<MockEntity>();
    const a = new MockEntity('a');
    const b = new MockEntity('b');
    system.add(a);
    system.add(b);
    const ctx = makeContext({ dt: 32 });
    system.update(32, ctx);
    expect(a.updateCount).toBe(1);
    expect(a.lastDt).toBe(32);
    expect(b.updateCount).toBe(1);
    expect(b.lastDt).toBe(32);
  });

  it('destroyAll destroys every entity and clears the collection', () => {
    const system = new EntitySystem<MockEntity>();
    const a = new MockEntity('a');
    const b = new MockEntity('b');
    system.add(a);
    system.add(b);
    system.destroyAll();
    expect(system.size).toBe(0);
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(true);
  });

  it('forEach iterates over all entities', () => {
    const system = new EntitySystem<MockEntity>();
    system.add(new MockEntity('x'));
    system.add(new MockEntity('y'));
    const visited: string[] = [];
    system.forEach((entity, id) => {
      visited.push(id);
      expect(entity.id).toBe(id);
    });
    expect(visited.sort()).toEqual(['x', 'y']);
  });

  it('values returns an iterable of all entities', () => {
    const system = new EntitySystem<MockEntity>();
    system.add(new MockEntity('p'));
    system.add(new MockEntity('q'));
    const ids = Array.from(system.values()).map((e) => e.id);
    expect(ids.sort()).toEqual(['p', 'q']);
  });
});
