/**
 * Skill orbit ring — faint dotted ring around a planet.
 * Each dot represents one installed skill. When a skill is active,
 * its dot pulses bright cyan.
 * @event-horizon/renderer
 */

import { Container, Graphics, Text } from 'pixi.js';

export interface SkillOrbitProps {
  agentId: string;
  /** Planet radius — orbit is drawn outside this. */
  planetRadius: number;
  /** Total number of installed skills. */
  skillCount: number;
}

export type ExtendedSkillOrbit = Container & {
  __agentId?: string;
  __skillCount?: number;
  __orbitRadius?: number;
  __activeIndex?: number;
  __label?: Text;
};

/** Dim dot color when idle. */
const DOT_COLOR_IDLE = 0x336666;
/** Bright dot color when active. */
const DOT_COLOR_ACTIVE = 0x44ddff;
/** Orbit ring distance multiplier from planet edge. */
const ORBIT_PADDING = 1.35;
/** Max dots to render (performance cap). */
const MAX_DOTS = 24;

export function createSkillOrbit(props: SkillOrbitProps): ExtendedSkillOrbit {
  const { agentId, planetRadius, skillCount } = props;
  const container = new Container() as ExtendedSkillOrbit;
  container.__agentId = agentId;
  container.__skillCount = skillCount;
  container.__activeIndex = -1;

  const orbitR = planetRadius * ORBIT_PADDING;
  container.__orbitRadius = orbitR;

  const dotCount = Math.min(skillCount, MAX_DOTS);
  if (dotCount > 0) {
    const g = new Graphics();
    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2;
      const dx = Math.cos(angle) * orbitR;
      const dy = Math.sin(angle) * orbitR;
      g.circle(dx, dy, 1.5).fill({ color: DOT_COLOR_IDLE, alpha: 0.6 });
    }
    container.addChild(g);
  }

  // Skill name label (hidden by default, shown when active)
  const label = new Text({
    text: '',
    style: { fontSize: 9, fill: '#44ddff', fontFamily: 'Consolas, monospace' },
  });
  label.anchor.set(0.5, 1);
  label.x = 0;
  label.y = -(orbitR + 6);
  label.visible = false;
  container.addChild(label);
  container.__label = label;

  return container;
}

/**
 * Update the skill orbit for the current frame.
 * Call this from the ticker loop.
 */
export function updateSkillOrbit(
  orbit: ExtendedSkillOrbit,
  t: number,
  activeSkillName: string | null,
  activeSkillIndex: number,
): void {
  const g = orbit.children[0] as Graphics | undefined;
  if (!g) return;

  const count = Math.min(orbit.__skillCount ?? 0, MAX_DOTS);
  const orbitR = orbit.__orbitRadius ?? 20;
  const prevIndex = orbit.__activeIndex ?? -1;

  // Only redraw dots if the active index changed
  if (activeSkillIndex !== prevIndex) {
    orbit.__activeIndex = activeSkillIndex;
    g.clear();
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dx = Math.cos(angle) * orbitR;
      const dy = Math.sin(angle) * orbitR;
      const isActive = i === activeSkillIndex;
      const dotSize = isActive ? 3 : 1.5;
      const color = isActive ? DOT_COLOR_ACTIVE : DOT_COLOR_IDLE;
      const alpha = isActive ? 1 : 0.6;
      g.circle(dx, dy, dotSize).fill({ color, alpha });
      if (isActive) {
        // Glow halo
        g.circle(dx, dy, dotSize * 2.5).fill({ color: DOT_COLOR_ACTIVE, alpha: 0.15 });
      }
    }
  }

  // Pulse the active dot
  if (activeSkillIndex >= 0 && activeSkillIndex < count) {
    const pulseScale = 1 + 0.15 * Math.sin(t * 6);
    g.scale.set(pulseScale);
  } else {
    g.scale.set(1);
  }

  // Slow rotation
  orbit.rotation = (orbit.rotation + 0.001) % (Math.PI * 2);

  // Label
  const label = orbit.__label;
  if (label) {
    if (activeSkillName) {
      label.text = `/${activeSkillName}`;
      label.visible = true;
      label.alpha = 0.7 + 0.3 * Math.sin(t * 3);
      // Counter-rotate label so text stays upright
      label.rotation = -orbit.rotation;
    } else {
      label.visible = false;
    }
  }
}
