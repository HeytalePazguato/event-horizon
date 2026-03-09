import type { AchievementDef } from '../types.js';

export const supernova: AchievementDef = {
  id: 'supernova',
  name: 'Supernova',
  desc: 'An agent entered an error state.',
  tiers: [1, 5, 10, 50],
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#180808" />
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const len = i % 3 === 0 ? 13 : 9;
        return (
          <line key={i}
            x1={18 + Math.cos(rad) * 5} y1={18 + Math.sin(rad) * 5}
            x2={18 + Math.cos(rad) * len} y2={18 + Math.sin(rad) * len}
            stroke={i % 2 === 0 ? '#ff6622' : '#ffcc44'}
            strokeWidth={i % 3 === 0 ? '2' : '1.2'}
            strokeOpacity="0.9"
          />
        );
      })}
      <circle cx="18" cy="18" r="5" fill="#ff4422" />
      <circle cx="18" cy="18" r="3" fill="#ff8844" />
      <circle cx="18" cy="18" r="1.5" fill="#ffeecc" />
      {[[9,9],[27,9],[9,27],[27,27]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="1" fill="#ff6622" fillOpacity="0.6" />
      ))}
    </svg>
  ),
};
