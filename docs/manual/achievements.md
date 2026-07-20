# Achievements

Event Horizon has **28 achievements** — milestones that track your multi-agent journey, from spawning your first agent to flinging astronauts into the black hole. They persist across sessions in the local database.

Find them in the **Medals** tab of the [Command Center](command-center.md#medals). Toggle the whole system — medals and toast notifications — with [`eventHorizon.achievementsEnabled`](configuration.md#eventhorizonachievementsenabled).

---

## How achievements work

- **One-shot** achievements unlock once when you do the thing.
- **Tiered** achievements have multiple levels (e.g. 1 → 5 → 25 → 100). Each tier unlocks as you cross its threshold; the Medals tab shows your current tier and progress.
- **Secret** achievements stay hidden — name and description blanked — until you earn them. They're the discovery layer; this page keeps them behind a spoiler block below.

---

## Agents & coordination

These come from actually using Event Horizon with real agents.

| Achievement | How to unlock | Type |
|-------------|---------------|------|
| **First Contact** | Your first agent appears in the universe | One-shot |
| **Uplink** | An agent connects to Event Horizon | Tiered (1, 3, 5, 10) |
| **Ground Control** | 3 or more agents active simultaneously | One-shot |
| **The Horde** | 10 agents active at the same time | One-shot |
| **Traffic Control** | Ships launched across the system (cooperating agents) | Tiered (10, 50, 100, 500, 1000) |
| **Supernova** | An agent enters an error state | Tiered (1, 5, 10, 50) |
| **Plugin Collector** | Discover skills installed on your system | Tiered (1, 5, 10, 25, 50, 100) |
| **Skill Master** | Invoke many different skills across your agents | Tiered (1, 5, 10, 25, 50) |

---

## The cosmic playground

These come from the [playful physics layer](the-universe.md#astronauts-ufos-and-the-playful-layer) — astronauts, UFOs, and shooting stars. They have nothing to do with your agents' actual work; they're there for fun.

| Achievement | How to unlock | Type |
|-------------|---------------|------|
| **Gravity Well** | An astronaut is consumed by the black hole | Tiered (1, 10, 50, 100, 1000, 10000) |
| **Grazing Shot** | An astronaut flies dangerously close to the black hole and survives | Tiered (1, 10, 50, 250) |
| **UFO Hunter** | Capture a UFO by clicking it | Tiered (1, 10, 50, 100, 500) |
| **Close Encounter** | The UFO completes a successful extraction | Tiered (1, 5, 25, 100) |
| **Star Catcher** | Click a shooting star as it streaks across the sky | Tiered (1, 10, 50, 250) |
| **Conqueror of Claude** | An astronaut lands on a Claude Code planet | One-shot |
| **Conqueror of OpenCode** | An astronaut lands on an OpenCode planet | One-shot |
| **Conqueror of Copilot** | An astronaut lands on a GitHub Copilot planet | One-shot |

---

## Secret achievements

!!! warning "Spoilers ahead"
    The following achievements are hidden in-app until earned. Expand only if you want the list.

??? note "Show the 12 secret achievements"

    | Achievement | How to unlock | Type |
    |-------------|---------------|------|
    | **Event Horizon** | An astronaut is trapped in the black hole's gravitational pull | Tiered (1, 5, 25, 100) |
    | **Simulation Theory** | Activate the demo simulation | One-shot |
    | **One Small Step** | Spawn an astronaut (click empty space) | One-shot |
    | **Rocket Man** | An astronaut fires its jetpack | Tiered (1, 10, 50, 100, 500) |
    | **Bouncy Boy** | An astronaut bounces off the edges 4 or more times | One-shot |
    | **Traveler** | An astronaut bounces off all 4 edges of the universe | One-shot |
    | **Slingshot** | An astronaut escapes the black hole's gravity well with a desperate jet burst | Tiered (1, 5, 25, 100) |
    | **Kamikaze** | An astronaut jets straight into the black hole without bouncing | Tiered (1, 5, 25) |
    | **Trick Shot** | An astronaut bounces off the edge and falls into the black hole | Tiered (1, 5, 25) |
    | **Staring Into The Abyss** | You stare at an agent for a very long time | One-shot |
    | **Butterfingers** | You interrupt the UFO beam and the cow falls back to safety | Tiered (1, 5, 25, 100) |
    | **Conqueror of the Unknown** | An astronaut lands on an unidentified planet | One-shot |

---

## Adding your own

Achievements are open source. If you're contributing to Event Horizon, the [achievements guide](https://github.com/HeytalePazguato/event-horizon/blob/master/packages/ui/src/achievements/README.md) walks through adding a new one — a def file, a registry entry, and a trigger.
