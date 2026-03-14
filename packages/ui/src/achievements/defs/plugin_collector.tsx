import type { AchievementDef } from '../types.js';

export const pluginCollector: AchievementDef = {
  id: 'plugin_collector',
  name: 'Plugin Collector',
  desc: 'Discover skills installed on your system.',
  tiers: [1, 5, 10, 25, 50, 100],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a1208" />
      {/* Chest / container */}
      <rect x="8" y="16" width="20" height="12" rx="2" fill="none" stroke="#8ab880" strokeWidth="1.5" />
      <rect x="8" y="16" width="20" height="4" rx="1" fill="#3a6a4a" fillOpacity="0.6" />
      {/* Lid */}
      <path d="M10 16 L18 8 L26 16" fill="none" stroke="#8ab880" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Gems inside */}
      <circle cx="14" cy="23" r="2" fill="#44ddff" fillOpacity="0.8" />
      <circle cx="22" cy="23" r="2" fill="#cc88ff" fillOpacity="0.8" />
      <circle cx="18" cy="22" r="1.5" fill="#ffdd66" fillOpacity="0.7" />
      {/* Sparkle */}
      <circle cx="18" cy="8" r="1" fill="#ffdd66" fillOpacity="0.9" />
    </svg>
  ),
};
