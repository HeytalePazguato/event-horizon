# Achievement System

Each achievement is a self-contained file in `defs/` containing its definition and medal SVG.

## Adding a new achievement

### 1. Create the definition file

Copy an existing file from `defs/` as a template. Each file exports an `AchievementDef`:

```tsx
// defs/my-achievement.tsx
import type { AchievementDef } from '../types.js';

export const myAchievement: AchievementDef = {
  id: 'my_achievement',        // unique ID, used for persistence
  name: 'My Achievement',      // display name
  desc: 'How you earn this.',   // shown in tooltip (hidden if secret)
  secret: true,                 // optional — hides description until earned
  tiers: [1, 5, 25, 100],      // optional — makes it tiered instead of one-shot
  Medal: ({ size: s = 36 }) => (
    <svg width={s} height={s} viewBox="0 0 36 36">
      {/* 36×36 SVG medal icon */}
    </svg>
  ),
};
```

**One-shot** achievements have no `tiers` — they unlock once and that's it.
**Tiered** achievements have a `tiers` array of thresholds. Reaching each threshold upgrades the tier (I, II, III...) and shows a toast.

### 2. Register it

In `registry.tsx`:
- Import your def at the top
- Add it to the `ALL_DEFS` array

That's it — `ACHIEVEMENTS`, `TIERED_THRESHOLDS`, and the medal lookup are auto-built from `ALL_DEFS`.

### 3. Add the trigger

In `apps/vscode/webview/index.tsx`, fire the achievement when the condition is met:

```tsx
// One-shot:
unlockAchievement('my_achievement');

// Tiered (call once per event, store handles threshold logic):
incrementTiered('my_achievement');
```

**Where to put triggers:**
- **Universe callbacks** — for renderer events (astronaut bounce, UFO click, etc.). Add the callback prop to `UniverseProps` in `Universe.tsx`, wire it in `index.tsx`.
- **`useEffect` hooks** — for state-derived conditions (agent count, error state, selection timer).
- **Event handler** — inside the `window.message` handler for server-sent events (agent spawn, tool call).

### 4. Demo guard

Achievements are automatically blocked during demo mode — no extra code needed. The only exception is `demo_activated` which is explicitly allowed in the store.

## File structure

```
achievements/
  defs/                   ← one file per achievement (definition + medal SVG)
    first-contact.tsx
    supernova.tsx
    ...
  types.ts                ← AchievementDef interface, TIER_LABELS, tierBorderColor
  registry.tsx            ← imports all defs, builds ACHIEVEMENTS + TIERED_THRESHOLDS
  AchievementsBar.tsx     ← medal strip inside CommandCenter
  AchievementToasts.tsx   ← slide-in toast notifications
  index.ts                ← barrel export
```

## Medal SVG guidelines

- Viewbox: `0 0 36 36`, rendered at 24px (bar) and 36px (toast)
- Background: `<rect width="36" height="36" rx="4" fill="#0a0a18" />` (dark, varies per theme)
- Keep it simple — recognizable at 24px
- Use inline SVG (no external assets — webview is sandboxed)
