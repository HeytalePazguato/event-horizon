import type { AchievementDef } from '../types.js';

export const gravityWell: AchievementDef = {
  id: 'gravity_well',
  name: 'Gravity Well',
  desc: 'An astronaut was consumed by the black hole.',
  tiers: [1, 10, 50, 100, 1000, 10000],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080808" />
      <circle cx="18" cy="18" r="13" fill="none" stroke="#c06020" strokeWidth="1.2" strokeOpacity="0.3" />
      <circle cx="18" cy="18" r="9" fill="none" stroke="#d07030" strokeWidth="1.2" strokeOpacity="0.5" />
      <circle cx="18" cy="18" r="6" fill="none" stroke="#e08040" strokeWidth="1.5" strokeOpacity="0.7" />
      <circle cx="18" cy="18" r="3" fill="none" stroke="#ffaa50" strokeWidth="1.5" strokeOpacity="0.9" />
      <circle cx="18" cy="18" r="4" fill="black" />
      <circle cx="18" cy="18" r="2.5" fill="#111" />
      <circle cx="27" cy="12" r="2" fill="white" fillOpacity="0.7" />
      <line x1="27" y1="12" x2="24" y2="15" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
      <path d="M 27 12 Q 24 10 22 14 Q 20 18 18 18" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" />
    </svg>
  ),
};
