/**
 * Achievement toast notifications — slide in from the right, auto-dismiss.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import { ACHIEVEMENTS, getMedal } from './registry.js';
import { TIER_LABELS, tierBorderColor } from './types.js';

const TOAST_DURATION_MS = 10_000;
const FADE_MS = 600;

interface ToastProps {
  instanceId: string;
  achievementId: string;
  onDone: (id: string) => void;
}

const AchievementToastItem: FC<ToastProps> = ({ instanceId, achievementId, onDone }) => {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
  const tier = useCommandCenterStore((s) => s.achievementTiers[achievementId]);
  const tierLabel = achievement?.tiers && tier != null ? ` ${TIER_LABELS[tier] ?? tier + 1}` : '';
  const accentColor = (achievement?.tiers ? tierBorderColor(tier) : undefined) ?? '#4a9a6a';
  const Medal = getMedal(achievementId);

  useEffect(() => {
    const showTimer = requestAnimationFrame(() => setVisible(true));
    const leaveTimer = setTimeout(() => setLeaving(true), TOAST_DURATION_MS - FADE_MS);
    const doneTimer = setTimeout(() => onDone(instanceId), TOAST_DURATION_MS);
    return () => {
      cancelAnimationFrame(showTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, [instanceId, onDone]);

  if (!achievement) return null;

  const opacity = leaving ? 0 : visible ? 1 : 0;
  const translateX = leaving ? 120 : visible ? 0 : 120;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'linear-gradient(90deg, #0e1f18 0%, #091510 100%)',
        border: `1px solid ${accentColor}55`,
        borderLeft: `3px solid ${accentColor}`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.7), inset 0 1px 0 ${accentColor}22`,
        position: 'relative',
        width: 240,
        overflow: 'hidden',
        opacity,
        transform: `translateX(${translateX}px)`,
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)',
          borderRight: '1px solid #1e3a28',
        }}
      >
        <Medal size={36} />
      </div>
      <div style={{ padding: '6px 8px', minWidth: 0 }}>
        <div style={{ fontSize: 8, color: accentColor, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
          {tier != null && tier > 0 ? 'Tier Upgraded' : 'Achievement Unlocked'}
        </div>
        <div style={{ fontSize: 11, color: '#c8e8b8', fontWeight: 600, lineHeight: 1.2, marginBottom: 2 }}>
          {achievement.name}{tierLabel}
        </div>
        <div style={{ fontSize: 9, color: '#6a8a72', lineHeight: 1.3 }}>
          {achievement.secret ? '???' : achievement.desc}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: accentColor,
          transformOrigin: 'left',
          animation: `eh-toast-shrink ${TOAST_DURATION_MS}ms linear forwards`,
        }}
      />
    </div>
  );
};

function ensureKeyframe() {
  if (document.getElementById('eh-toast-keyframe')) return;
  const style = document.createElement('style');
  style.id = 'eh-toast-keyframe';
  style.textContent = `@keyframes eh-toast-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }`;
  document.head.appendChild(style);
}

export const AchievementToasts: FC = () => {
  const toasts = useCommandCenterStore((s) => s.activeToasts);
  const dismiss = useCommandCenterStore((s) => s.dismissToast);

  useEffect(() => { ensureKeyframe(); }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 280,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column-reverse',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <AchievementToastItem
          key={t.instanceId}
          instanceId={t.instanceId}
          achievementId={t.achievementId}
          onDone={dismiss}
        />
      ))}
    </div>
  );
};
