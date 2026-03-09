import type { AchievementDef } from '../types.js';

export const slingshot: AchievementDef = {
  id: 'slingshot',
  name: 'Slingshot',
  desc: "An astronaut escaped the black hole's gravity well with a desperate jet burst.",
  secret: true,
  tiers: [1, 5, 25, 100],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#040810" />
      <circle cx="12" cy="22" r="4" fill="#000" />
      <circle cx="12" cy="22" r="6" fill="none" stroke="#ff6622" strokeWidth="1" strokeOpacity="0.4" />
      <path d="M 14 20 Q 18 16 26 10" fill="none" stroke="#ffcc44" strokeWidth="0.8" strokeOpacity="0.5" strokeDasharray="2 1" />
      <circle cx="26" cy="10" r="2.5" fill="#ffffff" />
      <circle cx="26" cy="10" r="1.2" fill="#88ccff" />
      <line x1="24" y1="12" x2="20" y2="16" stroke="#ff8822" strokeWidth="1.5" strokeOpacity="0.8" />
      <line x1="23" y1="11" x2="19" y2="14" stroke="#ffcc44" strokeWidth="1" strokeOpacity="0.6" />
      <circle cx="19" cy="15" r="1.5" fill="#ffaa33" fillOpacity="0.5" />
      <line x1="28" y1="8" x2="32" y2="5" stroke="white" strokeWidth="0.5" strokeOpacity="0.3" />
      <line x1="29" y1="11" x2="33" y2="9" stroke="white" strokeWidth="0.5" strokeOpacity="0.2" />
    </svg>
  ),
};
