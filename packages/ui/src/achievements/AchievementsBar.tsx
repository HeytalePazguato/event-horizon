/**
 * Achievements bar — persistent medal strip inside CommandCenter.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useRef } from 'react';
import { useCommandCenterStore } from '../store.js';
import { ACHIEVEMENTS, getMedal } from './registry.js';
import { TIER_LABELS, tierBorderColor } from './types.js';

export const AchievementsBar: FC = () => {
  const unlockedIds = useCommandCenterStore((s) => s.unlockedAchievements);
  const achievementTiers = useCommandCenterStore((s) => s.achievementTiers);
  const achievementCounts = useCommandCenterStore((s) => s.achievementCounts);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  if (unlockedIds.length === 0) return null;

  return (
    <div
      style={{
        padding: '3px 10px 3px 14px',
        borderBottom: '1px solid #0e1c18',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        background: 'rgba(0,0,0,0.35)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      <span style={{ fontSize: 7, color: '#2a6040', letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: 5, flexShrink: 0 }}>
        Medals
      </span>
      {unlockedIds.map((id) => {
        const ach = ACHIEVEMENTS.find((a) => a.id === id);
        const tier = achievementTiers[id];
        const count = achievementCounts[id];
        const tierLabel = ach?.tiers && tier != null ? ` ${TIER_LABELS[tier] ?? tier + 1}` : '';
        const borderColor = ach?.tiers ? tierBorderColor(tier) : undefined;
        const Medal = getMedal(id);
        return (
          <div
            key={id}
            style={{ position: 'relative', flexShrink: 0, cursor: 'default' }}
            onMouseEnter={() => setHoveredId(id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={{
              opacity: 0.92,
              transition: 'opacity 0.15s',
              position: 'relative',
              ...(hoveredId === id ? { opacity: 1 } : {}),
              ...(borderColor ? { border: `2px solid ${borderColor}`, borderRadius: 4, boxShadow: `0 0 6px ${borderColor}66` } : {}),
            }}>
              <Medal size={24} />
              {tierLabel && (
                <span style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  fontSize: 7,
                  fontWeight: 700,
                  color: '#fff',
                  background: borderColor ?? '#444',
                  borderRadius: 2,
                  padding: '0 2px',
                  lineHeight: '10px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {TIER_LABELS[tier] ?? ''}
                </span>
              )}
            </div>
            {hoveredId === id && ach && (
              <div
                ref={tooltipRef}
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'linear-gradient(180deg, #0e1f18 0%, #091510 100%)',
                  border: `1px solid ${borderColor ?? '#2a5a3c'}`,
                  borderRadius: 2,
                  padding: '5px 8px',
                  minWidth: 130,
                  maxWidth: 200,
                  zIndex: 999,
                  pointerEvents: 'none',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.7)',
                }}
              >
                <div style={{ fontSize: 10, color: '#c8e8b8', fontWeight: 700, marginBottom: 2 }}>
                  {ach.name}{tierLabel}
                </div>
                <div style={{ fontSize: 8, color: '#6a9a7a', lineHeight: 1.4 }}>
                  {ach.secret ? '???' : ach.desc}
                  {ach.tiers && count != null && (
                    <span style={{ display: 'block', marginTop: 2, color: '#4a7a5a' }}>
                      Count: {count}{tier != null && tier < ach.tiers.length - 1 ? ` / next at ${ach.tiers[tier + 1]}` : ''}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
