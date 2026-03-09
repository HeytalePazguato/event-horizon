import type { AchievementDef } from '../types.js';

export const kamikaze: AchievementDef = {
  id: 'kamikaze',
  name: 'Kamikaze',
  desc: 'An astronaut jetted straight into the black hole without bouncing.',
  secret: true,
  tiers: [1, 5, 25],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#100404" />
      <circle cx="18" cy="26" r="6" fill="#000" />
      <circle cx="18" cy="26" r="8" fill="none" stroke="#ff4422" strokeWidth="1.2" strokeOpacity="0.5" />
      <circle cx="18" cy="10" r="2.5" fill="white" />
      <circle cx="18" cy="10" r="1.2" fill="#88ccff" />
      <line x1="18" y1="8" x2="18" y2="3" stroke="#ff8822" strokeWidth="2" strokeOpacity="0.8" />
      <line x1="17" y1="7" x2="16" y2="3" stroke="#ffcc44" strokeWidth="1" strokeOpacity="0.5" />
      <line x1="19" y1="7" x2="20" y2="3" stroke="#ffcc44" strokeWidth="1" strokeOpacity="0.5" />
      <line x1="18" y1="12" x2="18" y2="20" stroke="#ff6644" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="2 2" />
      <text x="26" y="14" fontSize="8" fill="#ff4422" fillOpacity="0.5" fontFamily="sans-serif">⚠</text>
    </svg>
  ),
};
