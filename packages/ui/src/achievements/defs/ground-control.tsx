import type { AchievementDef } from '../types.js';

export const groundControl: AchievementDef = {
  id: 'ground_control',
  name: 'Ground Control',
  desc: '3 or more agents active simultaneously.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0a18" />
      <circle cx="18" cy="18" r="2.5" fill="#ffcc44" fillOpacity="0.9" />
      <ellipse cx="18" cy="18" rx="10" ry="4" fill="none" stroke="#334" strokeWidth="0.8" strokeDasharray="2,2" />
      <ellipse cx="18" cy="18" rx="6" ry="10" fill="none" stroke="#334" strokeWidth="0.8" strokeDasharray="2,2" />
      <circle cx="28" cy="18" r="3.5" fill="#6ba3c4" />
      <ellipse cx="28" cy="16.5" rx="3.2" ry="0.9" fill="#4a8aa8" fillOpacity="0.8" />
      <circle cx="18" cy="8" r="2.8" fill="#8b5a3c" />
      <circle cx="16.5" cy="7" r="1" fill="#a07050" fillOpacity="0.8" />
      <circle cx="12" cy="24" r="2.2" fill="#5a9aa8" />
      <ellipse cx="12" cy="23.2" rx="1.8" ry="0.7" fill="#ddf6ff" fillOpacity="0.7" />
    </svg>
  ),
};
