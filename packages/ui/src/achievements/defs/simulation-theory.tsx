import type { AchievementDef } from '../types.js';

export const simulationTheory: AchievementDef = {
  id: 'demo_activated',
  name: 'Simulation Theory',
  desc: 'You activated the demo simulation.',
  secret: true,
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#001a00" />
      {[5,10,15,20,25,30].map((x,i) => (
        <g key={i}>
          <text x={x} y={8 + (i * 7) % 28} fontSize="7" fill="#00ff44" fillOpacity={0.3 + (i % 3) * 0.2} fontFamily="monospace">
            {['0','1','0','1','0','1'][i]}
          </text>
          <text x={x} y={18 + (i * 11) % 20} fontSize="6" fill="#00cc33" fillOpacity={0.2 + (i % 2) * 0.15} fontFamily="monospace">
            {['1','0','1','0','1','0'][i]}
          </text>
        </g>
      ))}
      <ellipse cx="18" cy="18" rx="8" ry="5" fill="none" stroke="#00ff44" strokeWidth="1.2" strokeOpacity="0.7" />
      <circle cx="18" cy="18" r="2.5" fill="#00ff44" fillOpacity="0.6" />
      <circle cx="17" cy="17" r="0.8" fill="#aaffaa" fillOpacity="0.8" />
    </svg>
  ),
};
