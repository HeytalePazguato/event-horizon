import type { AchievementDef } from '../types.js';

export const rocketMan: AchievementDef = {
  id: 'rocket_man',
  name: 'Rocket Man',
  desc: 'An astronaut fired its jetpack.',
  secret: true,
  tiers: [1, 10, 50, 100, 500],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c18" />
      {[[5,5],[30,7],[8,28],[28,30]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="0.6" fill="white" fillOpacity="0.4" />
      ))}
      <circle cx="18" cy="14" r="4" fill="#c8ddf0" fillOpacity="0.9" />
      <ellipse cx="18.5" cy="13.5" rx="2.5" ry="2" fill="#0a1830" fillOpacity="0.9" />
      <rect x="15" y="17" width="6" height="5" rx="1" fill="#e2ecf8" fillOpacity="0.9" />
      <polygon points="16,22 20,22 22,30 14,30" fill="#ff6622" fillOpacity="0.7" />
      <polygon points="17,22 19,22 20,28 16,28" fill="#ffaa33" fillOpacity="0.8" />
      <polygon points="17.5,23 18.5,23 19,26 17,26" fill="#ffee88" fillOpacity="0.9" />
      <line x1="12" y1="16" x2="8" y2="18" stroke="white" strokeWidth="0.5" strokeOpacity="0.25" />
      <line x1="24" y1="16" x2="28" y2="18" stroke="white" strokeWidth="0.5" strokeOpacity="0.25" />
    </svg>
  ),
};
