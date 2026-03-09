import type { AchievementDef } from '../types.js';

export const closeEncounter: AchievementDef = {
  id: 'abduction',
  name: 'Close Encounter',
  desc: 'The UFO completed a successful extraction.',
  tiers: [1, 5, 25, 100],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c10" />
      {[[4,4],[32,6],[6,30],[30,28],[28,14]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="0.7" fill="white" fillOpacity="0.5" />
      ))}
      <ellipse cx="18" cy="10" rx="9" ry="4" fill="#8a8aaa" />
      <ellipse cx="18" cy="8" rx="5" ry="3.5" fill="#4a8a5a" />
      <circle cx="16" cy="7" r="1" fill="#88ddaa" fillOpacity="0.6" />
      {[[-6,0],[-3,2.5],[0,3.5],[3,2.5],[6,0]].map(([dx,dy],i) => (
        <circle key={i} cx={18+(dx as number)} cy={10+(dy as number)} r="1.2" fill={i%2===0 ? '#ffee44' : '#ff6644'} />
      ))}
      <polygon points="14,14 22,14 25,28 11,28" fill="#ffee44" fillOpacity="0.25" />
      <line x1="14" y1="14" x2="11" y2="28" stroke="#ffee88" strokeWidth="0.8" strokeOpacity="0.6" />
      <line x1="22" y1="14" x2="25" y2="28" stroke="#ffee88" strokeWidth="0.8" strokeOpacity="0.6" />
      <ellipse cx="18" cy="24" rx="3.5" ry="2" fill="#f4f4ec" />
      <ellipse cx="21" cy="23.5" rx="2.5" ry="1.8" fill="#f0efdf" />
      <circle cx="21" cy="22.5" r="0.6" fill="#111" />
      <ellipse cx="20" cy="22" rx="0.8" ry="1.2" fill="#f0d8d0" />
    </svg>
  ),
};
