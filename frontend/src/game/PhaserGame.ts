import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { BackgroundLoaderScene } from "./scenes/BackgroundLoaderScene";

export class PhaserGame {
  private game: Phaser.Game;
  private readonly dpr: number;

  constructor(parentId: string) {
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.game = new Phaser.Game({
      // Canvas is the most compatible mode for mobile browsers/webviews.
      type: Phaser.CANVAS,
      backgroundColor: "#0a1026",
      width,
      height,
      resolution: this.dpr,
      autoRound: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: parentId
      },
      scene: [BootScene, MenuScene, BattleScene, BackgroundLoaderScene]
    });
    window.addEventListener("resize", () => {
      this.game.scale.resize(window.innerWidth, window.innerHeight);
    });

  }

  showMenu() {
    if (this.game.scene.isActive("BattleScene")) {
      this.game.scene.stop("BattleScene");
    }
    this.game.scene.start("MenuScene");
  }

  startBattle(payload: {
    playerLineup: string[];
    opponentLineup: Array<{ id: string; hero: string; upgrades: { piercingLevel: number } }>;
    rounds: Array<{ playerHero: string; opponentHero: string; result: "win" | "lose" }>;
    result: "win" | "lose";
    weatherKey: string;
  }) {
    if (this.game.scene.isActive("MenuScene")) {
      this.game.scene.stop("MenuScene");
    }
    this.game.scene.start("BattleScene", payload);
  }
}
