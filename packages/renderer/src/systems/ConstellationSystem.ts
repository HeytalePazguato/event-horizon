/**
 * Constellation System — draw lines between planets that share knowledge.
 * Workspace knowledge lines are dim and always visible.
 * Plan knowledge lines are brighter and appear/disappear with the plan.
 * User-authored lines have gold tint; agent-authored use agent colors.
 * Line brightness is proportional to shared entry count.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface KnowledgeLink {
  fromAgentId: string;
  toAgentId: string;
  scope: 'workspace' | 'plan';
  authorIsUser: boolean;
  count: number;
}

const WORKSPACE_COLOR = 0x1a3020;
const PLAN_COLOR = 0x3a6a4a;
const USER_AUTHORED_COLOR = 0xd4a84a;

/** Agent-type colors used when author is an agent. */
const AGENT_TYPE_COLORS: Record<string, number> = {
  'claude-code': 0x88aaff,
  'copilot':     0xcc88ff,
  'opencode':    0x88ffaa,
  'cursor':      0x44ddcc,
};
const DEFAULT_AGENT_COLOR = 0xaaccff;

export class ConstellationSystem {
  private container: Container;
  private gfx: Graphics;

  constructor(container: Container) {
    this.container = container;
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);
  }

  /**
   * Redraw all constellation lines.
   * Called when knowledge data changes (not every frame).
   */
  update(
    links: KnowledgeLink[],
    posMap: Map<string, { x: number; y: number }>,
    agentTypes?: Record<string, string>,
  ): void {
    this.gfx.clear();

    for (const link of links) {
      const fromPos = posMap.get(link.fromAgentId);
      const toPos = posMap.get(link.toAgentId);
      if (!fromPos || !toPos) continue;

      // Determine color
      let color: number;
      if (link.authorIsUser) {
        color = USER_AUTHORED_COLOR;
      } else if (link.scope === 'plan') {
        // Agent-authored plan links — try agent type color
        const fromType = agentTypes?.[link.fromAgentId];
        color = (fromType ? AGENT_TYPE_COLORS[fromType] : undefined) ?? DEFAULT_AGENT_COLOR;
      } else {
        color = WORKSPACE_COLOR;
      }

      // Brightness scales with count (1 entry = base, 10+ = near max)
      const countFactor = Math.min(1, link.count / 10);
      const baseAlpha = link.scope === 'workspace' ? 0.15 : 0.25;
      const alpha = baseAlpha + countFactor * 0.35;

      // Width scales slightly with count
      const width = link.scope === 'workspace' ? 0.8 : 1.2;

      // Draw the line
      if (link.scope === 'workspace') {
        // Dotted style — draw dashes
        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        const dashLen = 4;
        const gapLen = 4;
        const segments = Math.floor(len / (dashLen + gapLen));
        for (let i = 0; i < segments; i++) {
          const t0 = (i * (dashLen + gapLen)) / len;
          const t1 = Math.min(1, (i * (dashLen + gapLen) + dashLen) / len);
          this.gfx.moveTo(
            fromPos.x + dx * t0,
            fromPos.y + dy * t0,
          );
          this.gfx.lineTo(
            fromPos.x + dx * t1,
            fromPos.y + dy * t1,
          );
        }
        this.gfx.stroke({ width, color, alpha });
      } else {
        // Solid line for plan knowledge
        this.gfx.moveTo(fromPos.x, fromPos.y);
        this.gfx.lineTo(toPos.x, toPos.y);
        this.gfx.stroke({ width, color, alpha });

        // Glow pass (use PLAN_COLOR for the ambient glow regardless of agent color)
        this.gfx.moveTo(fromPos.x, fromPos.y);
        this.gfx.lineTo(toPos.x, toPos.y);
        this.gfx.stroke({ width: width + 3, color: PLAN_COLOR, alpha: alpha * 0.1 });
      }
    }
  }

  destroy(): void {
    this.container.removeChild(this.gfx);
    this.gfx.destroy();
  }
}
