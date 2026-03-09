import type { AchievementDef } from '../types.js';

export const eventHorizon: AchievementDef = {
  id: 'event_horizon',
  name: 'Event Horizon',
  desc: 'An astronaut was trapped in the gravitational pull of the black hole.',
  secret: true,
  tiers: [1, 5, 25, 100],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0404" />
      <circle cx="18" cy="18" r="6" fill="#000" />
      <circle cx="18" cy="18" r="8" fill="none" stroke="#ff6622" strokeWidth="1.5" strokeOpacity="0.6" />
      <circle cx="18" cy="18" r="11" fill="none" stroke="#cc4400" strokeWidth="0.8" strokeOpacity="0.35" />
      <path d="M 28 14 Q 24 8 18 10 Q 12 12 14 18 Q 16 24 22 22" fill="none" stroke="#ffaa44" strokeWidth="0.8" strokeOpacity="0.5" strokeDasharray="2 2" />
      <circle cx="22" cy="22" r="2" fill="#ffffff" />
      <circle cx="22" cy="22" r="1" fill="#88ccff" />
      <circle cx="18" cy="18" r="14" fill="none" stroke="#ff4422" strokeWidth="0.5" strokeOpacity="0.2" />
    </svg>
  ),
};
