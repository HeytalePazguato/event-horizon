/**
 * Achievement system — definitions, medal icons, and toast notifications.
 * Toasts appear above the command center on the right side, show for 10 s,
 * then slide out. Each achievement has a unique 36×36 SVG medal.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useEffect, useState, useRef } from 'react';
import { useCommandCenterStore } from './store.js';

// ── Achievement definitions ───────────────────────────────────────────────────

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_contact',    name: 'First Contact',         desc: 'Your first agent appeared in the universe.' },
  { id: 'ground_control',   name: 'Ground Control',        desc: '3 or more agents active simultaneously.' },
  { id: 'the_horde',        name: 'The Horde',             desc: '10 agents active at the same time.' },
  { id: 'traffic_control',  name: 'Traffic Control',       desc: '10 ships launched across the system.' },
  { id: 'supernova',        name: 'Supernova',             desc: 'An agent entered an error state.' },
  { id: 'gravity_well',     name: 'Gravity Well',          desc: 'An astronaut was consumed by the black hole.' },
  { id: 'abduction',        name: 'Close Encounter',       desc: 'The UFO completed a successful extraction.' },
  { id: 'lone_astronaut',   name: 'One Small Step',        desc: 'You spawned an astronaut.', secret: true },
  { id: 'abyss',            name: 'Staring Into The Abyss',desc: 'You stared at an agent for a very long time.', secret: true },
];

// ── Medal SVG icons ───────────────────────────────────────────────────────────

const Medal: FC<{ id: string; size?: number }> = ({ id, size = 36 }) => {
  const s = size;

  switch (id) {
    case 'first_contact':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#1a1008" />
          {/* Rocket body */}
          <ellipse cx="18" cy="14" rx="5" ry="8" fill="#e08030" />
          <polygon points="18,4 13,14 23,14" fill="#f0a040" />
          {/* Fins */}
          <polygon points="13,18 10,24 13,22" fill="#c06020" />
          <polygon points="23,18 26,24 23,22" fill="#c06020" />
          {/* Exhaust */}
          <ellipse cx="18" cy="23" rx="3" ry="2" fill="#ff8820" fillOpacity="0.9" />
          <ellipse cx="18" cy="26" rx="2" ry="3" fill="#ffcc44" fillOpacity="0.7" />
          <ellipse cx="18" cy="29" rx="1" ry="2" fill="#ffee88" fillOpacity="0.5" />
          {/* Window */}
          <circle cx="18" cy="14" r="2.5" fill="#88ccff" />
          <circle cx="17" cy="13" r="0.8" fill="white" fillOpacity="0.6" />
          {/* Stars */}
          <circle cx="7" cy="8" r="0.8" fill="white" fillOpacity="0.7" />
          <circle cx="28" cy="6" r="0.6" fill="white" fillOpacity="0.6" />
          <circle cx="30" cy="20" r="0.7" fill="white" fillOpacity="0.5" />
          <circle cx="6" cy="25" r="0.6" fill="white" fillOpacity="0.4" />
        </svg>
      );

    case 'ground_control':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#0a0a18" />
          {/* Center orbit */}
          <circle cx="18" cy="18" r="2.5" fill="#ffcc44" fillOpacity="0.9" />
          {/* Orbit rings */}
          <ellipse cx="18" cy="18" rx="10" ry="4" fill="none" stroke="#334" strokeWidth="0.8" strokeDasharray="2,2" />
          <ellipse cx="18" cy="18" rx="6" ry="10" fill="none" stroke="#334" strokeWidth="0.8" strokeDasharray="2,2" />
          {/* 3 planets */}
          <circle cx="28" cy="18" r="3.5" fill="#6ba3c4" />
          <ellipse cx="28" cy="16.5" rx="3.2" ry="0.9" fill="#4a8aa8" fillOpacity="0.8" />
          <circle cx="18" cy="8" r="2.8" fill="#8b5a3c" />
          <circle cx="16.5" cy="7" r="1" fill="#a07050" fillOpacity="0.8" />
          <circle cx="12" cy="24" r="2.2" fill="#5a9aa8" />
          <ellipse cx="12" cy="23.2" rx="1.8" ry="0.7" fill="#ddf6ff" fillOpacity="0.7" />
        </svg>
      );

    case 'the_horde':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#080818" />
          {/* 10 small planets scattered */}
          {[
            [8,8,'#6ba3c4'], [14,6,'#8b5a3c'], [22,7,'#c05040'], [29,9,'#5a9aa8'],
            [6,18,'#c8b090'], [12,20,'#6ba3c4'], [20,17,'#8b5a3c'], [28,19,'#c05040'],
            [10,28,'#5a9aa8'], [24,27,'#c8b090'],
          ].map(([x, y, color], i) => (
            <circle key={i} cx={x as number} cy={y as number} r="2.5" fill={color as string} />
          ))}
          {/* Center glow */}
          <circle cx="18" cy="18" r="5" fill="#ffcc44" fillOpacity="0.12" />
          <circle cx="18" cy="18" r="2" fill="#ffcc44" fillOpacity="0.3" />
        </svg>
      );

    case 'traffic_control':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#0a1018" />
          {/* Arc paths */}
          <path d="M 6 28 Q 18 4 30 28" fill="none" stroke="#88aaff" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
          <path d="M 30 8 Q 18 32 6 8" fill="none" stroke="#88ffaa" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
          {/* Ship 1 */}
          <polygon points="16,14 22,17 16,20" fill="#88aaff" />
          {/* Trail 1 */}
          <line x1="8" y1="25" x2="16" y2="17" stroke="#88aaff" strokeWidth="1.5" strokeOpacity="0.6" />
          {/* Ship 2 */}
          <polygon points="20,22 14,19 20,16" fill="#88ffaa" />
          {/* Trail 2 */}
          <line x1="28" y1="11" x2="20" y2="19" stroke="#88ffaa" strokeWidth="1.5" strokeOpacity="0.6" />
          {/* Planets */}
          <circle cx="5" cy="28" r="3" fill="#8b5a3c" />
          <circle cx="31" cy="28" r="3" fill="#6ba3c4" />
          <circle cx="31" cy="8" r="3" fill="#c05040" />
          <circle cx="5" cy="8" r="3" fill="#5a9aa8" />
        </svg>
      );

    case 'supernova':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#180808" />
          {/* Explosion rays */}
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const len = i % 3 === 0 ? 13 : 9;
            return (
              <line key={i}
                x1={18 + Math.cos(rad) * 5} y1={18 + Math.sin(rad) * 5}
                x2={18 + Math.cos(rad) * len} y2={18 + Math.sin(rad) * len}
                stroke={i % 2 === 0 ? '#ff6622' : '#ffcc44'}
                strokeWidth={i % 3 === 0 ? '2' : '1.2'}
                strokeOpacity="0.9"
              />
            );
          })}
          {/* Core */}
          <circle cx="18" cy="18" r="5" fill="#ff4422" />
          <circle cx="18" cy="18" r="3" fill="#ff8844" />
          <circle cx="18" cy="18" r="1.5" fill="#ffeecc" />
          {/* Debris */}
          {[[9,9],[27,9],[9,27],[27,27]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r="1" fill="#ff6622" fillOpacity="0.6" />
          ))}
        </svg>
      );

    case 'gravity_well':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#080808" />
          {/* Spiral rings */}
          <circle cx="18" cy="18" r="13" fill="none" stroke="#c06020" strokeWidth="1.2" strokeOpacity="0.3" />
          <circle cx="18" cy="18" r="9" fill="none" stroke="#d07030" strokeWidth="1.2" strokeOpacity="0.5" />
          <circle cx="18" cy="18" r="6" fill="none" stroke="#e08040" strokeWidth="1.5" strokeOpacity="0.7" />
          <circle cx="18" cy="18" r="3" fill="none" stroke="#ffaa50" strokeWidth="1.5" strokeOpacity="0.9" />
          {/* Black hole */}
          <circle cx="18" cy="18" r="4" fill="black" />
          <circle cx="18" cy="18" r="2.5" fill="#111" />
          {/* Spiraling astronaut */}
          <circle cx="27" cy="12" r="2" fill="white" fillOpacity="0.7" />
          <line x1="27" y1="12" x2="24" y2="15" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
          {/* Swirl streak */}
          <path d="M 27 12 Q 24 10 22 14 Q 20 18 18 18" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" />
        </svg>
      );

    case 'abduction':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#080c10" />
          {/* Stars */}
          {[[4,4],[32,6],[6,30],[30,28],[28,14]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r="0.7" fill="white" fillOpacity="0.5" />
          ))}
          {/* UFO */}
          <ellipse cx="18" cy="10" rx="9" ry="4" fill="#8a8aaa" />
          <ellipse cx="18" cy="8" rx="5" ry="3.5" fill="#4a8a5a" />
          <circle cx="16" cy="7" r="1" fill="#88ddaa" fillOpacity="0.6" />
          {/* Rim lights */}
          {[[-6,0],[-3,2.5],[0,3.5],[3,2.5],[6,0]].map(([dx,dy],i) => (
            <circle key={i} cx={18+dx} cy={10+dy} r="1.2" fill={i%2===0 ? '#ffee44' : '#ff6644'} />
          ))}
          {/* Beam */}
          <polygon points="14,14 22,14 25,28 11,28" fill="#ffee44" fillOpacity="0.25" />
          <line x1="14" y1="14" x2="11" y2="28" stroke="#ffee88" strokeWidth="0.8" strokeOpacity="0.6" />
          <line x1="22" y1="14" x2="25" y2="28" stroke="#ffee88" strokeWidth="0.8" strokeOpacity="0.6" />
          {/* Cow (tiny) */}
          <ellipse cx="18" cy="24" rx="3.5" ry="2" fill="#f4f4ec" />
          <ellipse cx="21" cy="23.5" rx="2.5" ry="1.8" fill="#f0efdf" />
          <circle cx="21" cy="22.5" r="0.6" fill="#111" />
          <ellipse cx="20" cy="22" rx="0.8" ry="1.2" fill="#f0d8d0" />
        </svg>
      );

    case 'lone_astronaut':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#080c18" />
          {/* Stars */}
          {[[5,6],[30,8],[8,28],[29,26],[16,4],[24,30]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r="0.7" fill="white" fillOpacity="0.4" />
          ))}
          {/* Astronaut silhouette */}
          {/* Helmet */}
          <circle cx="18" cy="12" r="6" fill="#c8ddf0" fillOpacity="0.88" />
          <ellipse cx="18.5" cy="11.5" rx="3.5" ry="3" fill="#0a1830" fillOpacity="0.95" />
          <ellipse cx="17" cy="10" rx="1" ry="0.6" fill="#99ccee" fillOpacity="0.75" />
          {/* Collar */}
          <ellipse cx="18" cy="17" rx="4" ry="2" fill="#b8c8d8" fillOpacity="0.9" />
          {/* Torso */}
          <rect x="13" y="17" width="10" height="8" rx="2" fill="#e2ecf8" fillOpacity="0.95" />
          {/* Backpack */}
          <rect x="22" y="17" width="3" height="6" rx="1" fill="#c0ccd8" fillOpacity="0.85" />
          {/* Arms */}
          <rect x="8" y="18" width="5" height="3" rx="1" fill="#d4dce8" fillOpacity="0.9" />
          <rect x="23" y="18" width="5" height="3" rx="1" fill="#d4dce8" fillOpacity="0.9" />
          {/* Legs */}
          <rect x="14" y="24" width="3" height="6" rx="1" fill="#d0d8e8" fillOpacity="0.9" />
          <rect x="19" y="24" width="3" height="6" rx="1" fill="#d0d8e8" fillOpacity="0.9" />
          {/* Gloves */}
          <circle cx="8.5" cy="21" r="1.5" fill="white" fillOpacity="0.75" />
          <circle cx="27.5" cy="21" r="1.5" fill="white" fillOpacity="0.75" />
        </svg>
      );

    case 'abyss':
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#060608" />
          {/* Outer glow rings */}
          <circle cx="18" cy="18" r="14" fill="none" stroke="#886600" strokeWidth="0.5" strokeOpacity="0.3" />
          <circle cx="18" cy="18" r="11" fill="none" stroke="#aa8800" strokeWidth="0.8" strokeOpacity="0.4" />
          {/* Iris */}
          <circle cx="18" cy="18" r="9" fill="#1a1200" />
          <circle cx="18" cy="18" r="8" fill="#2a1e00" />
          {/* Iris rings */}
          <circle cx="18" cy="18" r="8" fill="none" stroke="#cc9900" strokeWidth="0.8" strokeOpacity="0.6" />
          <circle cx="18" cy="18" r="6" fill="none" stroke="#ddaa00" strokeWidth="0.6" strokeOpacity="0.5" />
          {/* Pupil */}
          <circle cx="18" cy="18" r="4.5" fill="#0a0800" />
          <circle cx="18" cy="18" r="3" fill="black" />
          {/* Gleam */}
          <ellipse cx="20" cy="16" rx="1.2" ry="0.8" fill="#ffee88" fillOpacity="0.55" />
          <ellipse cx="16" cy="19.5" rx="0.5" ry="0.4" fill="#ffee88" fillOpacity="0.3" />
          {/* Eyelids / lashes suggestion */}
          <path d="M 8 18 Q 18 10 28 18" fill="none" stroke="#cc9900" strokeWidth="1" strokeOpacity="0.5" />
          <path d="M 8 18 Q 18 26 28 18" fill="none" stroke="#cc9900" strokeWidth="1" strokeOpacity="0.5" />
        </svg>
      );

    default:
      return (
        <svg width={s} height={s} viewBox="0 0 36 36">
          <rect width="36" height="36" rx="4" fill="#1a1a2a" />
          <text x="18" y="23" textAnchor="middle" fontSize="18" fill="#aaa">🏅</text>
        </svg>
      );
  }
};

// Export Medal for use in MetricsPanel
export { Medal };

// ── Achievements bar (persistent, shown inside CommandCenter) ─────────────────

export const AchievementsBar: FC = () => {
  const unlockedIds = useCommandCenterStore((s) => s.unlockedAchievements);
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
        return (
          <div
            key={id}
            style={{ position: 'relative', flexShrink: 0, cursor: 'default' }}
            onMouseEnter={() => setHoveredId(id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={{ opacity: 0.92, transition: 'opacity 0.15s', ...(hoveredId === id ? { opacity: 1 } : {}) }}>
              <Medal id={id} size={24} />
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
                  border: '1px solid #2a5a3c',
                  borderRadius: 2,
                  padding: '5px 8px',
                  minWidth: 130,
                  maxWidth: 200,
                  zIndex: 999,
                  pointerEvents: 'none',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.7)',
                }}
              >
                <div style={{ fontSize: 10, color: '#c8e8b8', fontWeight: 700, marginBottom: 2 }}>{ach.name}</div>
                <div style={{ fontSize: 8, color: '#6a9a7a', lineHeight: 1.4 }}>
                  {ach.secret ? '???' : ach.desc}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Toast component ───────────────────────────────────────────────────────────

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

  useEffect(() => {
    // Fade in
    const showTimer = requestAnimationFrame(() => setVisible(true));

    // Start fade-out after TOAST_DURATION_MS - FADE_MS
    const leaveTimer = setTimeout(() => setLeaving(true), TOAST_DURATION_MS - FADE_MS);

    // Remove after full duration
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
        border: '1px solid #2a5a3c',
        borderLeft: '3px solid #4a9a6a',
        boxShadow: '0 2px 12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(80,160,100,0.12)',
        width: 240,
        overflow: 'hidden',
        opacity,
        transform: `translateX(${translateX}px)`,
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
        marginBottom: 6,
      }}
    >
      {/* Medal square */}
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
        <Medal id={achievementId} size={36} />
      </div>

      {/* Text */}
      <div style={{ padding: '6px 8px', minWidth: 0 }}>
        <div style={{ fontSize: 8, color: '#4a9a6a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
          Achievement Unlocked
        </div>
        <div style={{ fontSize: 11, color: '#c8e8b8', fontWeight: 600, lineHeight: 1.2, marginBottom: 2 }}>
          {achievement.name}
        </div>
        <div style={{ fontSize: 9, color: '#6a8a72', lineHeight: 1.3 }}>
          {achievement.secret ? '???' : achievement.desc}
        </div>
      </div>

      {/* Timer bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: '#4a9a6a',
          transformOrigin: 'left',
          animation: `eh-toast-shrink ${TOAST_DURATION_MS}ms linear forwards`,
        }}
      />
    </div>
  );
};

// Inject keyframe once
let keyframeInjected = false;
function ensureKeyframe() {
  if (keyframeInjected) return;
  keyframeInjected = true;
  const style = document.createElement('style');
  style.textContent = `@keyframes eh-toast-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }`;
  document.head.appendChild(style);
}

// ── Main toast container ──────────────────────────────────────────────────────

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
        bottom: 152,  // sits just above the command center (≈140px tall)
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
