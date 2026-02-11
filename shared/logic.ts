import { HeroType, WeatherDef } from "./types";

export type MatchupState = "advantage" | "disadvantage" | "even";

/**
 * Asymmetric matchup table (rock-paper-scissors with balanced power budgets):
 *
 * Design principle: strong attacker = weak weather support, weak attacker = strong weather.
 * All heroes peak at 74% (advantage + best weather) and floor at 26% (disadvantage + opponent best weather).
 *
 * Shark → Whale:   +18%  — fierce predator, strongest attack but weakest weather
 * Whale → Shrimp:  +14%  — overwhelming size, weakest attack but strongest weather
 * Shrimp → Shark:  +16%  — agile evasion, balanced attack and weather
 */
const MATCHUP_BONUS: Record<string, number> = {
  "Shark:Whale": 0.18,
  "Whale:Shrimp": 0.14,
  "Shrimp:Shark": 0.16
};

export function getMatchupState(player: HeroType, opponent: HeroType): MatchupState {
  if (player === opponent) return "even";
  if (MATCHUP_BONUS[`${player}:${opponent}`]) return "advantage";
  return "disadvantage";
}

/** Returns the matchup bonus (positive = advantage, negative = disadvantage). */
export function getMatchupBonus(player: HeroType, opponent: HeroType): number {
  const adv = MATCHUP_BONUS[`${player}:${opponent}`];
  if (adv) return adv;
  const dis = MATCHUP_BONUS[`${opponent}:${player}`];
  if (dis) return -dis;
  return 0;
}

export function getWeatherBonus(weather: WeatherDef, hero: HeroType): number {
  return weather.favored === hero ? weather.bonus : 0;
}

export function clampChance(value: number, min = 0.25, max = 0.85): number {
  return Math.min(max, Math.max(min, value));
}

/** Win-streak bonus: +2% per streak level, max +10% at streak 5 */
export function getStreakBonus(streak: number): number {
  return Math.min(0.10, Math.max(0, streak) * 0.02);
}

/** Synergy bonus when both weapon and armor are equipped on a hero */
export const SYNERGY_BONUS = 0.03;
