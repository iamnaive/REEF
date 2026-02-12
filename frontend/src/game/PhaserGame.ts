import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { BackgroundLoaderScene } from "./scenes/BackgroundLoaderScene";

function shouldUseCanvasRenderer() {
  try {
    const hasCoarsePointer =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const hasLowCoreCount = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
    return hasCoarsePointer || hasLowCoreCount;
  } catch {
    return true;
  }
}

export class PhaserGame {
  private game: Phaser.Game;

  constructor(parentId: string) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const renderType = shouldUseCanvasRenderer() ? Phaser.CANVAS : Phaser.AUTO;
    this.game = new Phaser.Game({
      type: renderType,
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
