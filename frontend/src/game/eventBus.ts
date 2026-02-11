import Phaser from "phaser";

export const eventBus = new Phaser.Events.EventEmitter();

export type BattleStartPayload = {
  playerLineup: string[];
  opponentLineup: Array<{ id: string; hero: string; upgrades: { piercingLevel: number } }>;
  rounds: Array<{ playerHero: string; opponentHero: string; result: "win" | "lose" }>;
  result: "win" | "lose";
  weatherKey: string;
};
