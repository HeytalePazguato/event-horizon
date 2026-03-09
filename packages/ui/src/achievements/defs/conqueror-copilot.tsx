import type { AchievementDef } from '../types.js';

export const conquerorCopilot: AchievementDef = {
  id: 'conqueror_copilot',
  name: 'Conqueror of Copilot',
  desc: 'An astronaut landed on a GitHub Copilot planet.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0a10" />
      {/* Rocky planet (Copilot variant) */}
      <circle cx="18" cy="20" r="10" fill="#887766" />
      <ellipse cx="18" cy="18" rx="10" ry="2" fill="#998877" fillOpacity="0.3" />
      <circle cx="15" cy="18" r="2" fill="#776655" fillOpacity="0.4" />
      <circle cx="22" cy="21" r="1.5" fill="#665544" fillOpacity="0.3" />
      {/* Astronaut with flag on top */}
      <circle cx="18" cy="8" r="2.5" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="18" cy="8" r="1.2" fill="#88ccff" />
      <line x1="20" y1="7" x2="20" y2="3" stroke="#ccc" strokeWidth="0.8" />
      <rect x="20" y="3" width="5" height="3" rx="0.5" fill="#6644cc" fillOpacity="0.8" />
      <text x="22.5" y="5.5" textAnchor="middle" fontSize="2.5" fill="white" fontWeight="bold">G</text>
    </svg>
  ),
};
