/**
 * UFO — flies to a planet and "extracts" a creature with a beam.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export function createUfo(): Container {
  const c = new Container();
  const body = new Graphics();
  body.ellipse(0, 0, 18, 8).fill({ color: 0x9a9aaa, alpha: 0.95 });
  body.ellipse(0, -4, 10, 6).fill({ color: 0x4a8a5a, alpha: 0.9 });
  c.addChild(body);
  const beam = new Graphics();
  beam.moveTo(-8, 8);
  beam.lineTo(8, 8);
  beam.lineTo(4, 28);
  beam.lineTo(-4, 28);
  beam.closePath();
  beam.fill({ color: 0xffdd44, alpha: 0.5 });
  c.addChild(beam);
  const cow = new Graphics();
  cow.ellipse(0, 20, 4, 3).fill({ color: 0xf8f8f8, alpha: 0.9 });
  cow.circle(-1.5, 19, 0.8).fill({ color: 0x1a1a1a, alpha: 0.9 });
  cow.circle(1.5, 19, 0.8).fill({ color: 0x1a1a1a, alpha: 0.9 });
  c.addChild(cow);
  c.visible = false;
  c.eventMode = 'none';
  return c;
}
