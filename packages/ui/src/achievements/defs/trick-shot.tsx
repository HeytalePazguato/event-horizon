import type { AchievementDef } from '../types.js';

export const trickShot: AchievementDef = {
  id: 'trick_shot',
  name: 'Trick Shot',
  desc: 'An astronaut bounced off the edge and fell into the black hole.',
  secret: true,
  tiers: [1, 5, 25],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0810" />
      <line x1="32" y1="2" x2="32" y2="34" stroke="#4a4a6a" strokeWidth="2" strokeOpacity="0.6" />
      <path d="M 20 6 L 30 14 L 14 26" fill="none" stroke="#ffcc44" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="2 2" />
      <circle cx="30" cy="14" r="3" fill="#ffee44" fillOpacity="0.3" />
      <circle cx="10" cy="28" r="5" fill="#000" />
      <circle cx="10" cy="28" r="7" fill="none" stroke="#ff6622" strokeWidth="1" strokeOpacity="0.4" />
      <circle cx="20" cy="20" r="2" fill="white" />
      <circle cx="20" cy="20" r="1" fill="#88ccff" />
      <line x1="22" y1="18" x2="26" y2="15" stroke="white" strokeWidth="0.5" strokeOpacity="0.3" />
    </svg>
  ),
};
