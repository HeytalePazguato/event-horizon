/**
 * Base Entity-Component-System pattern for the renderer.
 * Each entity has an id, a PixiJS container, update/destroy methods.
 * Systems manage collections of entities with add/remove/update/destroyAll.
 * Phase F — Universe ECS Refactor.
 */

import type { Container } from 'pixi.js';

/** Context passed to every entity's update function. */
export interface UpdateContext {
  dt: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  animationSpeed: number;
}

/** Base interface for all managed entities. */
export interface Entity {
  id: string;
  container: Container;
  update(dt: number, context: UpdateContext): void;
  destroy(): void;
}

/**
 * Generic entity system — manages a typed collection of entities.
 * Subclass or instantiate directly for each entity type (astronauts, ships, UFOs, etc.).
 */
export class EntitySystem<T extends Entity> {
  protected entities: Map<string, T> = new Map();

  add(entity: T): void {
    const existing = this.entities.get(entity.id);
    if (existing) existing.destroy();
    this.entities.set(entity.id, entity);
  }

  remove(id: string): void {
    const entity = this.entities.get(id);
    if (entity) {
      entity.destroy();
      this.entities.delete(id);
    }
  }

  get(id: string): T | undefined {
    return this.entities.get(id);
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  get size(): number {
    return this.entities.size;
  }

  update(dt: number, context: UpdateContext): void {
    for (const entity of this.entities.values()) {
      entity.update(dt, context);
    }
  }

  forEach(fn: (entity: T, id: string) => void): void {
    this.entities.forEach(fn);
  }

  values(): IterableIterator<T> {
    return this.entities.values();
  }

  destroyAll(): void {
    for (const entity of this.entities.values()) {
      entity.destroy();
    }
    this.entities.clear();
  }
}
