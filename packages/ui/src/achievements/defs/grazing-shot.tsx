import type { AchievementDef } from '../types.js';

export const grazingShot: AchievementDef = {
  id: 'grazing_shot',
  name: 'Grazing Shot',
  desc: 'An astronaut flew dangerously close to the black hole and lived to tell the tale.',
  tiers: [1, 10, 50, 250],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#060410" />
      <circle cx="14" cy="20" r="5" fill="#000" />
      <circle cx="14" cy="20" r="7" fill="none" stroke="#ff4422" strokeWidth="0.8" strokeOpacity="0.3" />
      <circle cx="14" cy="20" r="9" fill="none" stroke="#cc2200" strokeWidth="0.5" strokeOpacity="0.15" />
      {/* Astronaut on a tangent arc */}
      <path d="M 8 10 Q 16 14 28 8" fill="none" stroke="#88ccff" strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="2 1.5" />
      <circle cx="26" cy="9" r="2.5" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="26" cy="9" r="1.2" fill="#88ccff" />
      {/* Jet trail */}
      <line x1="24" y1="10" x2="21" y2="12" stroke="#ff8833" strokeWidth="1.2" strokeOpacity="0.7" />
      <line x1="23" y1="11" x2="20" y2="13" stroke="#ffcc44" strokeWidth="0.8" strokeOpacity="0.5" />
      {/* Sweat drops */}
      <circle cx="29" cy="7" r="0.8" fill="#aaddff" fillOpacity="0.6" />
      <circle cx="30" cy="10" r="0.6" fill="#aaddff" fillOpacity="0.4" />
    </svg>
  ),
};
