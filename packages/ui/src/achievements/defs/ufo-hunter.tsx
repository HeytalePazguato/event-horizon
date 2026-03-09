import type { AchievementDef } from '../types.js';

export const ufoHunter: AchievementDef = {
  id: 'ufo_hunter',
  name: 'UFO Hunter',
  desc: 'You captured a UFO by clicking on it.',
  tiers: [1, 10, 50, 100, 500],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c14" />
      <circle cx="18" cy="18" r="12" fill="none" stroke="#44aa66" strokeWidth="1" strokeOpacity="0.5" />
      <circle cx="18" cy="18" r="7" fill="none" stroke="#44aa66" strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="18" y1="4" x2="18" y2="14" stroke="#44aa66" strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="18" y1="22" x2="18" y2="32" stroke="#44aa66" strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="4" y1="18" x2="14" y2="18" stroke="#44aa66" strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="22" y1="18" x2="32" y2="18" stroke="#44aa66" strokeWidth="0.8" strokeOpacity="0.4" />
      <ellipse cx="18" cy="17" rx="7" ry="3" fill="#8a8aaa" />
      <ellipse cx="18" cy="15.5" rx="4" ry="2.8" fill="#4a8a5a" />
      <circle cx="17" cy="14.5" r="0.8" fill="#88ddaa" fillOpacity="0.6" />
      {[-4, -1.5, 1.5, 4].map((dx, i) => (
        <circle key={i} cx={18 + dx} cy={17 + Math.abs(dx) * 0.3} r="1" fill={i % 2 === 0 ? '#ffee44' : '#ff6644'} />
      ))}
      <circle cx="18" cy="17" r="3" fill="#88ffaa" fillOpacity="0.2" />
    </svg>
  ),
};
