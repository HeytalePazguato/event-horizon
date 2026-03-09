import type { AchievementDef } from '../types.js';

export const traveler: AchievementDef = {
  id: 'traveler',
  name: 'Traveler',
  desc: 'An astronaut bounced off all 4 edges of the universe.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080810" />
      <polygon points="18,3 16,7 20,7" fill="#44aaff" fillOpacity="0.7" />
      <polygon points="18,33 16,29 20,29" fill="#44aaff" fillOpacity="0.7" />
      <polygon points="3,18 7,16 7,20" fill="#44aaff" fillOpacity="0.7" />
      <polygon points="33,18 29,16 29,20" fill="#44aaff" fillOpacity="0.7" />
      <path d="M 18 7 L 29 18 L 18 29 L 7 18 Z" fill="none" stroke="#44aaff" strokeWidth="0.8" strokeOpacity="0.35" strokeDasharray="3 2" />
      <circle cx="18" cy="18" r="3" fill="white" fillOpacity="0.85" />
      <circle cx="18" cy="18" r="1.5" fill="#88ccff" />
      <circle cx="18" cy="18" r="8" fill="none" stroke="#44aaff" strokeWidth="0.6" strokeOpacity="0.2" />
    </svg>
  ),
};
