import type { AchievementDef } from '../types.js';

export const conquerorUnknown: AchievementDef = {
  id: 'conqueror_unknown',
  name: 'Conqueror of the Unknown',
  desc: 'An astronaut landed on an unidentified planet.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080808" />
      {/* Volcanic planet (unknown variant) */}
      <circle cx="18" cy="20" r="10" fill="#553322" />
      <circle cx="16" cy="18" r="2.5" fill="#ff4422" fillOpacity="0.3" />
      <circle cx="21" cy="22" r="2" fill="#ff6644" fillOpacity="0.25" />
      <ellipse cx="18" cy="18" rx="10" ry="2" fill="#883311" fillOpacity="0.3" />
      {/* Astronaut with flag on top */}
      <circle cx="18" cy="8" r="2.5" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="18" cy="8" r="1.2" fill="#88ccff" />
      <line x1="20" y1="7" x2="20" y2="3" stroke="#ccc" strokeWidth="0.8" />
      <rect x="20" y="3" width="5" height="3" rx="0.5" fill="#888" fillOpacity="0.8" />
      <text x="22.5" y="5.5" textAnchor="middle" fontSize="2.5" fill="white" fontWeight="bold">?</text>
    </svg>
  ),
};
