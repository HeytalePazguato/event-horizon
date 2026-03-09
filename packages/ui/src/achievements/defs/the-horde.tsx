import type { AchievementDef } from '../types.js';

export const theHorde: AchievementDef = {
  id: 'the_horde',
  name: 'The Horde',
  desc: '10 agents active at the same time.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080818" />
      {[
        [8,8,'#6ba3c4'], [14,6,'#8b5a3c'], [22,7,'#c05040'], [29,9,'#5a9aa8'],
        [6,18,'#c8b090'], [12,20,'#6ba3c4'], [20,17,'#8b5a3c'], [28,19,'#c05040'],
        [10,28,'#5a9aa8'], [24,27,'#c8b090'],
      ].map(([x, y, color], i) => (
        <circle key={i} cx={x as number} cy={y as number} r="2.5" fill={color as string} />
      ))}
      <circle cx="18" cy="18" r="5" fill="#ffcc44" fillOpacity="0.12" />
      <circle cx="18" cy="18" r="2" fill="#ffcc44" fillOpacity="0.3" />
    </svg>
  ),
};
