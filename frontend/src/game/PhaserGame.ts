import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { BackgroundLoaderScene } from "./scenes/BackgroundLoaderScene";

export class PhaserGame {
  private game: Phaser.Game;

  constructor(parentId: string) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      backgroundColor: "#0a1026",
      width,
      height,
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
