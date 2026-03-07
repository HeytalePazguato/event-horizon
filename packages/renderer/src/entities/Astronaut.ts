/**
 * Astronaut — floats in space, affected by gravity.
 * Seven unique poses/styles for visual variety.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const SIZE = 6;

/**
 * Create an astronaut with one of 7 visual variants.
 * @param variant 0-6, determines the pose/style. Defaults to random.
 */
export function createAstronaut(variant?: number): Container {
  const v = variant ?? Math.floor(Math.random() * 7);
  const c = new Container();

  switch (v) {
    case 0: // Classic — front-facing, arms at sides
      drawHelmet(c, 0xd0e0f0);
      drawBody(c, 0xe8e8e8);
      drawArms(c, 0xe0e0e0, 'down');
      drawLegs(c, 0xd8d8d8, 'straight');
      drawVisor(c, 0x2a2a4a);
      break;

    case 1: // Waving — one arm raised
      drawHelmet(c, 0xd0f0e0);
      drawBody(c, 0xe0e8e0);
      drawArms(c, 0xd8e0d8, 'wave');
      drawLegs(c, 0xd0d8d0, 'straight');
      drawVisor(c, 0x1a2a2a);
      break;

    case 2: // Tumbling — rotated 45 degrees, arms spread
      drawHelmet(c, 0xf0d0d0);
      drawBody(c, 0xe8e0e0);
      drawArms(c, 0xe0d8d8, 'spread');
      drawLegs(c, 0xd8d0d0, 'spread');
      drawVisor(c, 0x2a1a2a);
      c.rotation = Math.PI / 4;
      break;

    case 3: // Curled / fetal — compact pose
      drawHelmet(c, 0xe0d0f0);
      drawCompactBody(c, 0xe0d8f0);
      drawVisor(c, 0x2a2a3a);
      break;

    case 4: // Jetpack — with visible backpack flame
      drawHelmet(c, 0xd0d8f0);
      drawBody(c, 0xe8e8f0);
      drawArms(c, 0xe0e0e8, 'down');
      drawLegs(c, 0xd8d8e0, 'thrust');
      drawVisor(c, 0x1a1a3a);
      drawJetpack(c);
      break;

    case 5: // Upside-down — legs up, drifting
      drawHelmet(c, 0xf0e0d0);
      drawBody(c, 0xe8e0d8);
      drawArms(c, 0xe0d8d0, 'spread');
      drawLegs(c, 0xd8d0c8, 'up');
      drawVisor(c, 0x2a2a1a);
      c.rotation = Math.PI;
      break;

    case 6: // Spacewalk — tethered, horizontal
    default:
      drawHelmet(c, 0xd8e8d0);
      drawBody(c, 0xe0e8d8);
      drawArms(c, 0xd8e0d0, 'reach');
      drawLegs(c, 0xd0d8c8, 'drift');
      drawVisor(c, 0x1a2a1a);
      drawTether(c);
      c.rotation = Math.PI / 6;
      break;
  }

  c.eventMode = 'none';
  c.cursor = 'default';
  return c;
}

function drawHelmet(parent: Container, color: number): void {
  const g = new Graphics();
  g.circle(0, -2, SIZE * 0.6).fill({ color, alpha: 0.85 });
  parent.addChild(g);
}

function drawVisor(parent: Container, color: number): void {
  const g = new Graphics();
  g.roundRect(-2.5, -4, 5, 3, 1).fill({ color, alpha: 0.9 });
  // Glint
  g.circle(-1, -3.5, 0.6).fill({ color: 0xffffff, alpha: 0.5 });
  parent.addChild(g);
}

function drawBody(parent: Container, color: number): void {
  const g = new Graphics();
  g.roundRect(-3, 1, 6, 7, 1.5).fill({ color, alpha: 0.92 });
  parent.addChild(g);
}

function drawCompactBody(parent: Container, color: number): void {
  const g = new Graphics();
  // Curled up body
  g.circle(0, 2, 5).fill({ color, alpha: 0.88 });
  // Knees
  g.circle(-2, 5, 2).fill({ color, alpha: 0.8 });
  g.circle(2, 5, 2).fill({ color, alpha: 0.8 });
  parent.addChild(g);
}

function drawArms(parent: Container, color: number, pose: string): void {
  const g = new Graphics();
  switch (pose) {
    case 'wave':
      // Left arm down
      g.roundRect(-5, 2, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      // Right arm up (waving)
      g.roundRect(3, -3, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      // Glove on raised hand
      g.circle(4, -4, 1.2).fill({ color: 0xffffff, alpha: 0.7 });
      break;
    case 'spread':
      g.roundRect(-7, 2, 4, 2, 0.8).fill({ color, alpha: 0.85 });
      g.roundRect(3, 2, 4, 2, 0.8).fill({ color, alpha: 0.85 });
      break;
    case 'reach':
      // Both arms reaching forward
      g.roundRect(-5, 0, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      g.roundRect(3, 0, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      g.circle(-5, 0, 1).fill({ color: 0xffffff, alpha: 0.6 });
      g.circle(5, 0, 1).fill({ color: 0xffffff, alpha: 0.6 });
      break;
    case 'down':
    default:
      g.roundRect(-5, 2, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      g.roundRect(3, 2, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      // Gloves
      g.circle(-4, 7.5, 1).fill({ color: 0xffffff, alpha: 0.6 });
      g.circle(4, 7.5, 1).fill({ color: 0xffffff, alpha: 0.6 });
      break;
  }
  parent.addChild(g);
}

function drawLegs(parent: Container, color: number, pose: string): void {
  const g = new Graphics();
  switch (pose) {
    case 'spread':
      g.roundRect(-5, 7, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      g.roundRect(3, 7, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      break;
    case 'thrust':
      // Legs together, angled for jetpack thrust
      g.roundRect(-2, 7, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      g.roundRect(0.5, 7, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      break;
    case 'up':
      // Legs pointing up (for upside-down astronaut — visually they point down in local coords)
      g.roundRect(-3, 7, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      g.roundRect(1, 7, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      break;
    case 'drift':
      // Relaxed, slightly bent
      g.roundRect(-3, 7, 2, 5, 0.8).fill({ color, alpha: 0.85 });
      g.roundRect(2, 8, 2, 4, 0.8).fill({ color, alpha: 0.85 });
      break;
    case 'straight':
    default:
      g.roundRect(-3, 7, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      g.roundRect(1, 7, 2, 5, 0.8).fill({ color, alpha: 0.88 });
      // Boots
      g.roundRect(-3.5, 11, 3, 1.5, 0.5).fill({ color: 0xaaaaaa, alpha: 0.7 });
      g.roundRect(0.5, 11, 3, 1.5, 0.5).fill({ color: 0xaaaaaa, alpha: 0.7 });
      break;
  }
  parent.addChild(g);
}

function drawJetpack(parent: Container): void {
  const g = new Graphics();
  // Backpack
  g.roundRect(4, 1, 3, 5, 1).fill({ color: 0x888888, alpha: 0.85 });
  // Flame
  g.ellipse(5.5, 8, 1.5, 2.5).fill({ color: 0xff8822, alpha: 0.7 });
  g.ellipse(5.5, 9, 1, 1.5).fill({ color: 0xffcc44, alpha: 0.6 });
  parent.addChild(g);
}

function drawTether(parent: Container): void {
  const g = new Graphics();
  // Tether line trailing behind
  g.moveTo(0, 4)
    .bezierCurveTo(8, 8, 14, 4, 18, 10)
    .stroke({ width: 0.8, color: 0xc0c0c0, alpha: 0.5 });
  parent.addChild(g);
}
