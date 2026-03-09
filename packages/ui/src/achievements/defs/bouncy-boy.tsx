import type { AchievementDef } from '../types.js';

export const bouncyBoy: AchievementDef = {
  id: 'bouncy_boy',
  name: 'Bouncy Boy',
  desc: 'An astronaut bounced off the edges 4 or more times.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#0a0a14" />
      <rect x="2" y="2" width="32" height="32" rx="1" fill="none" stroke="#3a3a5a" strokeWidth="1" strokeOpacity="0.5" />
      <path d="M 8 4 L 30 12 L 6 22 L 28 30" fill="none" stroke="#88ffaa" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="2 2" />
      {[[8,4],[30,12],[6,22],[28,30]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill="#88ffaa" fillOpacity={0.2 + i * 0.05} />
      ))}
      <circle cx="18" cy="17" r="2.5" fill="white" fillOpacity="0.9" />
      <circle cx="18" cy="17" r="1.2" fill="#88ccff" />
      <text x="28" y="10" fontSize="8" fill="#88ffaa" fillOpacity="0.7" fontFamily="monospace" fontWeight="bold">4×</text>
    </svg>
  ),
};
