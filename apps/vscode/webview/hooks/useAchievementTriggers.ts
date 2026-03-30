/**
 * Achievement trigger hooks — detects conditions and unlocks achievements.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ShipSpawn } from '@event-horizon/renderer';
import type { AgentState } from '@event-horizon/core';

interface AchievementDeps {
  agents: Array<{ id: string; name: string; agentType?: string; cwd?: string }>;
  agentMap: Record<string, AgentState>;
  ships: ShipSpawn[];
  selectedAgentId: string | null;
  unlockAchievement: (id: string) => void;
  incrementTiered: (id: string) => void;
  incrementStat: (key: string) => void;
  selectSingularity: () => void;
}

/** Callbacks returned for Universe renderer events. */
export interface AchievementCallbacks {
  handleAstronautConsumed: () => void;
  handleAstronautSpawned: () => void;
  handleUfoAbduction: () => void;
  handleUfoClicked: () => void;
  handleSingularityClick: () => void;
  handleUfoConsumed: () => void;
  handleAstronautTrapped: () => void;
  handleAstronautEscaped: () => void;
  handleAstronautBounced: (astronautId: number, bounceCount: number, edgesHit: Set<string>) => void;
  handleRocketMan: () => void;
  handleTrickShot: () => void;
  handleKamikaze: () => void;
  handleCowDrop: () => void;
  handleShootingStarClicked: () => void;
  handleAstronautGrazed: () => void;
  handleAstronautLanded: (agentId: string) => void;
}

export function useAchievementTriggers(deps: AchievementDeps): AchievementCallbacks {
  const {
    agents, agentMap, ships, selectedAgentId,
    unlockAchievement, incrementTiered, incrementStat, selectSingularity,
  } = deps;

  const abyssTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // first_contact / ground_control / the_horde — triggered by agent count
  useEffect(() => {
    if (agents.length >= 1)  unlockAchievement('first_contact');
    if (agents.length >= 3)  unlockAchievement('ground_control');
    if (agents.length >= 10) unlockAchievement('the_horde');
  }, [agents.length, unlockAchievement]);

  // supernova — any agent enters error state (tiered)
  const prevErrorCountRef = useRef(0);
  useEffect(() => {
    const errorCount = Object.values(agentMap).filter((a) => a.state === 'error').length;
    if (errorCount > prevErrorCountRef.current) {
      for (let i = 0; i < errorCount - prevErrorCountRef.current; i++) incrementTiered('supernova');
    }
    prevErrorCountRef.current = errorCount;
  }, [agentMap, incrementTiered]);

  // traffic_control — count total ships launched (tiered)
  const prevShipCountRef = useRef(0);
  useEffect(() => {
    const current = ships.length;
    const prev = prevShipCountRef.current;
    if (current > prev) {
      for (let i = 0; i < current - prev; i++) incrementTiered('traffic_control');
    }
    prevShipCountRef.current = current;
  }, [ships.length, incrementTiered]);

  // abyss — selected an agent and kept it selected for 60 seconds
  useEffect(() => {
    if (abyssTimerRef.current) clearTimeout(abyssTimerRef.current);
    if (selectedAgentId) {
      abyssTimerRef.current = setTimeout(() => unlockAchievement('abyss'), 60_000);
    }
    return () => { if (abyssTimerRef.current) clearTimeout(abyssTimerRef.current); };
  }, [selectedAgentId, unlockAchievement]);

  // ── Renderer event callbacks ──

  const handleAstronautConsumed = useCallback(() => {
    incrementTiered('gravity_well');
    incrementStat('astronautsConsumed');
  }, [incrementTiered, incrementStat]);

  const handleAstronautSpawned = useCallback(() => {
    unlockAchievement('lone_astronaut');
  }, [unlockAchievement]);

  const handleUfoAbduction = useCallback(() => {
    incrementTiered('abduction');
    incrementStat('cowsAbducted');
  }, [incrementTiered, incrementStat]);

  const handleUfoClicked = useCallback(() => {
    incrementTiered('ufo_hunter');
  }, [incrementTiered]);

  const handleSingularityClick = useCallback(() => {
    selectSingularity();
  }, [selectSingularity]);

  const handleUfoConsumed = useCallback(() => {
    incrementStat('ufosConsumed');
  }, [incrementStat]);

  const handleAstronautTrapped = useCallback(() => {
    incrementTiered('event_horizon');
  }, [incrementTiered]);

  const handleAstronautEscaped = useCallback(() => {
    incrementTiered('slingshot');
  }, [incrementTiered]);

  const handleAstronautBounced = useCallback((astronautId: number, bounceCount: number, edgesHit: Set<string>) => {
    if (bounceCount >= 4) unlockAchievement('bouncy_boy');
    if (edgesHit.size >= 4) unlockAchievement('traveler');
  }, [unlockAchievement]);

  const handleRocketMan = useCallback(() => { incrementTiered('rocket_man'); }, [incrementTiered]);
  const handleTrickShot = useCallback(() => { incrementTiered('trick_shot'); }, [incrementTiered]);
  const handleKamikaze = useCallback(() => { incrementTiered('kamikaze'); }, [incrementTiered]);
  const handleCowDrop = useCallback(() => { incrementTiered('cow_drop'); }, [incrementTiered]);
  const handleShootingStarClicked = useCallback(() => { incrementTiered('star_catcher'); }, [incrementTiered]);
  const handleAstronautGrazed = useCallback(() => { incrementTiered('grazing_shot'); }, [incrementTiered]);

  const handleAstronautLanded = useCallback((agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const type = agent?.agentType ?? 'unknown';
    const achievementMap: Record<string, string> = {
      'claude-code': 'conqueror_claude',
      'opencode': 'conqueror_opencode',
      'copilot': 'conqueror_copilot',
      'unknown': 'conqueror_unknown',
    };
    unlockAchievement(achievementMap[type] ?? 'conqueror_unknown');
  }, [agents, unlockAchievement]);

  return {
    handleAstronautConsumed, handleAstronautSpawned, handleUfoAbduction, handleUfoClicked,
    handleSingularityClick, handleUfoConsumed, handleAstronautTrapped, handleAstronautEscaped,
    handleAstronautBounced, handleRocketMan, handleTrickShot, handleKamikaze, handleCowDrop,
    handleShootingStarClicked, handleAstronautGrazed, handleAstronautLanded,
  };
}
