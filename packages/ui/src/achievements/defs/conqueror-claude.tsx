import type { AchievementDef } from '../types.js';

export const conquerorClaude: AchievementDef = {
  id: 'conqueror_claude',
  name: 'Conqueror of Claude',
  desc: 'An astronaut landed on a Claude Code planet.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0c0818" />
      {/* Gas giant planet (Claude Code variant) */}
      <circle cx="18" cy="20" r="10" fill="#cc7744" />
      <ellipse cx="18" cy="18" rx="10" ry="2" fill="#dd9966" fillOpacity="0.4" />
      <ellipse cx="18" cy="22" rx="9" ry="1.5" fill="#bb6633" fillOpacity="0.3" />
      {/* Astronaut with flag on top */}
      <circle cx="18" cy="8" r="2.5" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="18" cy="8" r="1.2" fill="#88ccff" />
      <line x1="20" y1="7" x2="20" y2="3" stroke="#ccc" strokeWidth="0.8" />
      <rect x="20" y="3" width="5" height="3" rx="0.5" fill="#ff6644" fillOpacity="0.8" />
      <text x="22.5" y="5.5" textAnchor="middle" fontSize="2.5" fill="white" fontWeight="bold">C</text>
    </svg>
  ),
};
