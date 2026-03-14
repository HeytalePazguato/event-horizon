import type { AchievementDef } from '../types.js';

export const skillMaster: AchievementDef = {
  id: 'skill_master',
  name: 'Skill Master',
  desc: 'Invoke many different skills across your agents.',
  tiers: [1, 5, 10, 25, 50],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0818" />
      {/* Wand */}
      <line x1="8" y1="28" x2="22" y2="12" stroke="#ccaaff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="22" cy="12" r="2" fill="#eeddff" />
      {/* Sparkles */}
      <circle cx="26" cy="8" r="1.2" fill="#ffdd66" fillOpacity="0.9" />
      <circle cx="28" cy="14" r="0.8" fill="#ffdd66" fillOpacity="0.6" />
      <circle cx="18" cy="8" r="0.9" fill="#aaddff" fillOpacity="0.7" />
      <circle cx="30" cy="10" r="0.6" fill="#ffffff" fillOpacity="0.5" />
      {/* Star at tip */}
      <polygon points="22,6 23,9 26,9 24,11 25,14 22,12 19,14 20,11 18,9 21,9" fill="#ffdd66" fillOpacity="0.8" />
    </svg>
  ),
};
