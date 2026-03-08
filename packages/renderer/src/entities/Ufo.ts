/**
 * UFO — flies to a planet, opens a tractor beam, and slowly pulls the cow up into the ship.
 * Beam length is dynamic (set via setUfoBeam once target planet radius is known).
 * Cow travels from planet surface all the way up to the UFO belly.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export type ExtendedUfo = Container & {
  __beam?: Graphics;
  __cow?: Container;
};

export function createUfo(): ExtendedUfo {
  const c = new Container() as ExtendedUfo;

  // ── Tractor beam (behind body, hidden until activated) ─────────────────────
  const beam = new Graphics();
  beam.visible = false;
  c.addChild(beam);
  c.__beam = beam;

  // ── Cow (behind body so it disappears "into" the saucer) ──────────────────
  const cow = buildCow();
  cow.visible = false;
  c.addChild(cow);
  c.__cow = cow;

  // ── Saucer body (on top — cow slides behind it) ───────────────────────────
  const body = new Graphics();
  body.ellipse(0, 0, 18, 8).fill({ color: 0x9a9aaa, alpha: 0.95 });
  // Lights around rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    body.circle(Math.cos(a) * 13, Math.sin(a) * 4, 1.5)
        .fill({ color: i % 2 === 0 ? 0xffee44 : 0xff6644, alpha: 0.9 });
  }
  body.ellipse(0, -4, 10, 6).fill({ color: 0x4a8a5a, alpha: 0.9 });
  // Cockpit dome highlight
  body.ellipse(-2, -6, 3, 2).fill({ color: 0x88ddaa, alpha: 0.55 });
  c.addChild(body);

  c.visible = false;
  c.eventMode = 'none';
  return c;
}

/**
 * Redraw the beam to reach the planet surface.
 * beamLength = planet.__radius + hover_offset (typically radius + 48).
 */
export function setUfoBeam(ufo: ExtendedUfo, beamLength: number): void {
  const beam = ufo.__beam;
  if (!beam) return;
  beam.clear();
  const spread = Math.min(beamLength * 0.28, 14);
  // Filled cone
  beam.moveTo(-7, 8)
      .lineTo(7, 8)
      .lineTo(spread, beamLength)
      .lineTo(-spread, beamLength)
      .closePath()
      .fill({ color: 0xffee44, alpha: 0.28 });
  // Glowing edges
  beam.moveTo(-7, 8).lineTo(-spread, beamLength)
      .stroke({ width: 1, color: 0xffee88, alpha: 0.65 });
  beam.moveTo(7, 8).lineTo(spread, beamLength)
      .stroke({ width: 1, color: 0xffee88, alpha: 0.65 });
  // Horizontal scan lines for the "scanning" feel
  const steps = 4;
  for (let s = 1; s <= steps; s++) {
    const ty = 8 + (beamLength - 8) * (s / (steps + 1));
    const hw = 7 + (spread - 7) * (s / (steps + 1));
    beam.moveTo(-hw, ty).lineTo(hw, ty)
        .stroke({ width: 0.5, color: 0xffee44, alpha: 0.18 });
  }
}

// ── Cow silhouette ────────────────────────────────────────────────────────────
function buildCow(): Container {
  const c = new Container();

  // Body (horizontal rectangle, white with black patches)
  const body = new Graphics();
  body.roundRect(-6, -3, 12, 6, 2).fill({ color: 0xf4f4ec, alpha: 0.97 });
  body.ellipse(1.5, -1, 3.5, 2.2).fill({ color: 0x1a1a1a, alpha: 0.82 });
  body.ellipse(-3, 1.5, 2.2, 1.5).fill({ color: 0x1a1a1a, alpha: 0.72 });
  c.addChild(body);

  // Head (to the right of the body)
  const head = new Graphics();
  head.ellipse(9, -0.5, 4, 3).fill({ color: 0xf0efdf, alpha: 0.97 });
  // Snout / muzzle
  head.ellipse(12, 0.5, 2, 1.4).fill({ color: 0xddbbbb, alpha: 0.9 });
  head.circle(11.4, 0.2, 0.45).fill({ color: 0xaa8888, alpha: 0.8 }); // nostril
  head.circle(12.6, 0.2, 0.45).fill({ color: 0xaa8888, alpha: 0.8 });
  // Eye
  head.circle(8, -1.5, 0.8).fill({ color: 0x111111, alpha: 0.95 });
  head.circle(7.7, -1.7, 0.25).fill({ color: 0xffffff, alpha: 0.7 }); // glint
  // Ear
  head.ellipse(6, -3.5, 1.2, 1.8).fill({ color: 0xf0d8d0, alpha: 0.88 });
  c.addChild(head);

  // Legs (4 short stumps below body)
  const legs = new Graphics();
  legs.roundRect(-5, 3, 2, 4, 0.6).fill({ color: 0xeeeede, alpha: 0.92 });
  legs.roundRect(-2, 3, 2, 4, 0.6).fill({ color: 0xeeeede, alpha: 0.92 });
  legs.roundRect(2, 3, 2, 4, 0.6).fill({ color: 0xeeeede, alpha: 0.92 });
  legs.roundRect(5, 3, 2, 4, 0.6).fill({ color: 0xeeeede, alpha: 0.92 });
  c.addChild(legs);

  // Tail (curled at the left)
  const tail = new Graphics();
  tail.arc(-7, 0, 3, -0.4, Math.PI * 0.6)
      .stroke({ width: 1, color: 0xc8c8b8, alpha: 0.85 });
  tail.circle(-8, 2, 1.2).fill({ color: 0xc8c8b8, alpha: 0.75 }); // tuft
  c.addChild(tail);

  // Udder (pink, under body)
  const udder = new Graphics();
  udder.ellipse(1, 4, 3, 1.5).fill({ color: 0xf0c8c0, alpha: 0.85 });
  c.addChild(udder);

  return c;
}
