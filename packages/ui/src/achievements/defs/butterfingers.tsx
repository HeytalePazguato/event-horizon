import type { AchievementDef } from '../types.js';

export const butterfingers: AchievementDef = {
  id: 'cow_drop',
  name: 'Butterfingers',
  desc: 'You interrupted the UFO beam and the cow fell back to safety.',
  secret: true,
  tiers: [1, 5, 25, 100],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c10" />
      <ellipse cx="18" cy="8" rx="7" ry="3" fill="#8a8aaa" />
      <ellipse cx="18" cy="6.5" rx="4" ry="2.5" fill="#4a8a5a" />
      <line x1="15" y1="11" x2="14" y2="18" stroke="#ffee44" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="2 3" />
      <line x1="21" y1="11" x2="22" y2="18" stroke="#ffee44" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="2 3" />
      <ellipse cx="18" cy="23" rx="3" ry="1.8" fill="#f4f4ec" />
      <ellipse cx="20.5" cy="22.5" rx="2" ry="1.5" fill="#f0efdf" />
      <line x1="15" y1="19" x2="15" y2="21" stroke="white" strokeWidth="0.5" strokeOpacity="0.3" />
      <line x1="21" y1="18" x2="21" y2="20" stroke="white" strokeWidth="0.5" strokeOpacity="0.3" />
      <line x1="18" y1="17" x2="18" y2="20" stroke="white" strokeWidth="0.5" strokeOpacity="0.4" />
      <ellipse cx="18" cy="31" rx="12" ry="3" fill="#5a4a3a" fillOpacity="0.6" />
      <circle cx="28" cy="8" r="3" fill="none" stroke="#ff6644" strokeWidth="1" strokeOpacity="0.5" />
      <line x1="28" y1="6" x2="28" y2="10" stroke="#ff6644" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  ),
};
