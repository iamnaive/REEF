import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { BackgroundLoaderScene } from "./scenes/BackgroundLoaderScene";

export class PhaserGame {
  private game: Phaser.Game;
  private readonly dpr: number;
  private readonly parentId: string;
  private resizeHandler?: () => void;

  constructor(parentId: string) {
    this.parentId = parentId;
    // Cap DPR for stable performance + sharp output on mobile retina screens.
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.game = this.createGame(Phaser.AUTO);
    this.resizeHandler = () => {
      this.game.scale.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", this.resizeHandler);
  }

  private createGame(rendererType: number) {
    return new Phaser.Game({
      type: rendererType,
      backgroundColor: "#0a1026",
      width: window.innerWidth,
      height: window.innerHeight,
      resolution: this.dpr,
      autoRound: false,
      render: {
        antialias: true,
        antialiasGL: true,
        pixelArt: false,
        roundPixels: false,
        powerPreference: "high-performance",
        mipmapFilter: "LINEAR",
        failIfMajorPerformanceCaveat: false,
        resolution: this.dpr
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: this.parentId
      },
      scene: [BootScene, MenuScene, BattleScene, BackgroundLoaderScene]
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
