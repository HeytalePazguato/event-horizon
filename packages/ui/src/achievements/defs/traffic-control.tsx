import type { AchievementDef } from '../types.js';

export const trafficControl: AchievementDef = {
  id: 'traffic_control',
  name: 'Traffic Control',
  desc: 'Ships launched across the system.',
  tiers: [10, 50, 100, 500, 1000],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a1018" />
      <path d="M 6 28 Q 18 4 30 28" fill="none" stroke="#88aaff" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
      <path d="M 30 8 Q 18 32 6 8" fill="none" stroke="#88ffaa" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
      <polygon points="16,14 22,17 16,20" fill="#88aaff" />
      <line x1="8" y1="25" x2="16" y2="17" stroke="#88aaff" strokeWidth="1.5" strokeOpacity="0.6" />
      <polygon points="20,22 14,19 20,16" fill="#88ffaa" />
      <line x1="28" y1="11" x2="20" y2="19" stroke="#88ffaa" strokeWidth="1.5" strokeOpacity="0.6" />
      <circle cx="5" cy="28" r="3" fill="#8b5a3c" />
      <circle cx="31" cy="28" r="3" fill="#6ba3c4" />
      <circle cx="31" cy="8" r="3" fill="#c05040" />
      <circle cx="5" cy="8" r="3" fill="#5a9aa8" />
    </svg>
  ),
};
