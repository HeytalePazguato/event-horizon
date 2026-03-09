import type { AchievementDef } from '../types.js';

export const uplink: AchievementDef = {
  id: 'agent_connected',
  name: 'Uplink',
  desc: 'An agent connected to Event Horizon.',
  tiers: [1, 3, 5, 10],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#081018" />
      <line x1="18" y1="28" x2="18" y2="14" stroke="#6090c0" strokeWidth="2" />
      <circle cx="18" cy="13" r="2" fill="#88bbff" />
      <path d="M 12 10 Q 18 4 24 10" fill="none" stroke="#44aaff" strokeWidth="1.2" strokeOpacity="0.7" />
      <path d="M 9 8 Q 18 0 27 8" fill="none" stroke="#44aaff" strokeWidth="1" strokeOpacity="0.45" />
      <path d="M 6 6 Q 18 -4 30 6" fill="none" stroke="#44aaff" strokeWidth="0.8" strokeOpacity="0.25" />
      <rect x="14" y="28" width="8" height="3" rx="1" fill="#3a5a7a" />
      <circle cx="18" cy="22" r="1.5" fill="#44ff88" fillOpacity="0.8" />
    </svg>
  ),
};
