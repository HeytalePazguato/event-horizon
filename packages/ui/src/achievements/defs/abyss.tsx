import type { AchievementDef } from '../types.js';

export const abyss: AchievementDef = {
  id: 'abyss',
  name: 'Staring Into The Abyss',
  desc: 'You stared at an agent for a very long time.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#060608" />
      <circle cx="18" cy="18" r="14" fill="none" stroke="#886600" strokeWidth="0.5" strokeOpacity="0.3" />
      <circle cx="18" cy="18" r="11" fill="none" stroke="#aa8800" strokeWidth="0.8" strokeOpacity="0.4" />
      <circle cx="18" cy="18" r="9" fill="#1a1200" />
      <circle cx="18" cy="18" r="8" fill="#2a1e00" />
      <circle cx="18" cy="18" r="8" fill="none" stroke="#cc9900" strokeWidth="0.8" strokeOpacity="0.6" />
      <circle cx="18" cy="18" r="6" fill="none" stroke="#ddaa00" strokeWidth="0.6" strokeOpacity="0.5" />
      <circle cx="18" cy="18" r="4.5" fill="#0a0800" />
      <circle cx="18" cy="18" r="3" fill="black" />
      <ellipse cx="20" cy="16" rx="1.2" ry="0.8" fill="#ffee88" fillOpacity="0.55" />
      <ellipse cx="16" cy="19.5" rx="0.5" ry="0.4" fill="#ffee88" fillOpacity="0.3" />
      <path d="M 8 18 Q 18 10 28 18" fill="none" stroke="#cc9900" strokeWidth="1" strokeOpacity="0.5" />
      <path d="M 8 18 Q 18 26 28 18" fill="none" stroke="#cc9900" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  ),
};
