import type { AchievementDef } from '../types.js';

export const firstContact: AchievementDef = {
  id: 'first_contact',
  name: 'First Contact',
  desc: 'Your first agent appeared in the universe.',
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      <rect width="36" height="36" rx="4" fill="#1a1008" />
      <ellipse cx="18" cy="14" rx="5" ry="8" fill="#e08030" />
      <polygon points="18,4 13,14 23,14" fill="#f0a040" />
      <polygon points="13,18 10,24 13,22" fill="#c06020" />
      <polygon points="23,18 26,24 23,22" fill="#c06020" />
      <ellipse cx="18" cy="23" rx="3" ry="2" fill="#ff8820" fillOpacity="0.9" />
      <ellipse cx="18" cy="26" rx="2" ry="3" fill="#ffcc44" fillOpacity="0.7" />
      <ellipse cx="18" cy="29" rx="1" ry="2" fill="#ffee88" fillOpacity="0.5" />
      <circle cx="18" cy="14" r="2.5" fill="#88ccff" />
      <circle cx="17" cy="13" r="0.8" fill="white" fillOpacity="0.6" />
      <circle cx="7" cy="8" r="0.8" fill="white" fillOpacity="0.7" />
      <circle cx="28" cy="6" r="0.6" fill="white" fillOpacity="0.6" />
      <circle cx="30" cy="20" r="0.7" fill="white" fillOpacity="0.5" />
      <circle cx="6" cy="25" r="0.6" fill="white" fillOpacity="0.4" />
    </svg>
  ),
};
