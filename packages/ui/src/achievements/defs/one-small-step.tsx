import type { AchievementDef } from '../types.js';

export const oneSmallStep: AchievementDef = {
  id: 'lone_astronaut',
  name: 'One Small Step',
  desc: 'You spawned an astronaut.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#080c18" />
      {[[5,6],[30,8],[8,28],[29,26],[16,4],[24,30]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="0.7" fill="white" fillOpacity="0.4" />
      ))}
      <circle cx="18" cy="12" r="6" fill="#c8ddf0" fillOpacity="0.88" />
      <ellipse cx="18.5" cy="11.5" rx="3.5" ry="3" fill="#0a1830" fillOpacity="0.95" />
      <ellipse cx="17" cy="10" rx="1" ry="0.6" fill="#99ccee" fillOpacity="0.75" />
      <ellipse cx="18" cy="17" rx="4" ry="2" fill="#b8c8d8" fillOpacity="0.9" />
      <rect x="13" y="17" width="10" height="8" rx="2" fill="#e2ecf8" fillOpacity="0.95" />
      <rect x="22" y="17" width="3" height="6" rx="1" fill="#c0ccd8" fillOpacity="0.85" />
      <rect x="8" y="18" width="5" height="3" rx="1" fill="#d4dce8" fillOpacity="0.9" />
      <rect x="23" y="18" width="5" height="3" rx="1" fill="#d4dce8" fillOpacity="0.9" />
      <rect x="14" y="24" width="3" height="6" rx="1" fill="#d0d8e8" fillOpacity="0.9" />
      <rect x="19" y="24" width="3" height="6" rx="1" fill="#d0d8e8" fillOpacity="0.9" />
      <circle cx="8.5" cy="21" r="1.5" fill="white" fillOpacity="0.75" />
      <circle cx="27.5" cy="21" r="1.5" fill="white" fillOpacity="0.75" />
    </svg>
  ),
};
