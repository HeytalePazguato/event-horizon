import type { AchievementDef } from '../types.js';

export const starCatcher: AchievementDef = {
  id: 'star_catcher',
  name: 'Star Catcher',
  desc: 'Clicked on a shooting star as it streaked across the sky.',
  tiers: [1, 10, 50, 250],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#060418" />
      {/* Shooting star trail */}
      <line x1="8" y1="28" x2="26" y2="8" stroke="#ffeedd" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="10" y1="27" x2="27" y2="9" stroke="#ddeeff" strokeWidth="0.6" strokeOpacity="0.3" />
      {/* Star head */}
      <circle cx="27" cy="8" r="3" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="27" cy="8" r="1.5" fill="#ffeedd" />
      {/* Sparkles */}
      <circle cx="20" cy="14" r="0.8" fill="#ffeedd" fillOpacity="0.5" />
      <circle cx="15" cy="20" r="0.6" fill="#ddeeff" fillOpacity="0.4" />
      <circle cx="23" cy="11" r="0.5" fill="#ffffff" fillOpacity="0.6" />
      {/* Hand/cursor hint */}
      <path d="M 28 18 L 30 16 L 31 18 L 29 20 Z" fill="#ffcc44" fillOpacity="0.5" />
    </svg>
  ),
};
