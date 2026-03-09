import type { AchievementDef } from '../types.js';

export const conquerorOpencode: AchievementDef = {
  id: 'conqueror_opencode',
  name: 'Conqueror of OpenCode',
  desc: 'An astronaut landed on an OpenCode planet.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c14" />
      {/* Icy planet (OpenCode variant) */}
      <circle cx="18" cy="20" r="10" fill="#6688aa" />
      <ellipse cx="18" cy="18" rx="10" ry="2" fill="#88aacc" fillOpacity="0.3" />
      <ellipse cx="16" cy="16" rx="3" ry="2" fill="#aaccee" fillOpacity="0.25" />
      {/* Astronaut with flag on top */}
      <circle cx="18" cy="8" r="2.5" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="18" cy="8" r="1.2" fill="#88ccff" />
      <line x1="20" y1="7" x2="20" y2="3" stroke="#ccc" strokeWidth="0.8" />
      <rect x="20" y="3" width="5" height="3" rx="0.5" fill="#44aa88" fillOpacity="0.8" />
      <text x="22.5" y="5.5" textAnchor="middle" fontSize="2.5" fill="white" fontWeight="bold">O</text>
    </svg>
  ),
};
